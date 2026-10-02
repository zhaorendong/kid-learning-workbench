# -*- coding: utf-8 -*-
"""用 GitHub 的 Git Data API 推送提交 —— 绕开走不通的 git 传输通道。

什么时候需要它：本机 `git push` 报 `CONNECT tunnel failed, response 502`
或直连卡 20 秒超时，但 `api.github.com` 是可用的（实测经常是这样）。

原理：Git 的对象哈希是**确定性**的 —— 只要 blob 内容、tree 结构、parent、
author/committer（含时间与时区）、message 全都一致，算出来的 commit sha 就一样。
所以这里用低层 API 逐个复刻本地提交：上传 blob → 构造 tree → 创建 commit → 移动 ref。

**安全措施**：创建完 commit 会拿它的 sha 跟本地比。**不一致就不动 ref**
（否则会造成本地/远程分叉，而这台机器 `git fetch` 又走不通，很难收拾）。

用法：
    python _build/push_via_api.py            # 推送所有本地领先的提交
    python _build/push_via_api.py --dry-run  # 只报告要推什么
"""
import base64
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = r'D:\workspaces\WorkBuddy\小悦饼知识库'
OWNER_REPO = 'zhaorendong/kid-learning-workbench'
BRANCH = 'main'
GIT = r'D:\Application\Git\cmd\git.exe'
if not os.path.exists(GIT):
    GIT = 'git'
API = 'https://api.github.com'

DRY = '--dry-run' in sys.argv
OUT = []


def log(*a):
    line = ' '.join(str(x) for x in a)
    OUT.append(line)
    print(line, flush=True)


def git(*args):
    p = subprocess.run([GIT, '-C', ROOT, '-c', 'core.quotepath=false'] + list(args),
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
    return p.stdout.decode('utf-8', 'replace')


def token():
    p = subprocess.run([GIT, 'credential', 'fill'],
                       input=b'protocol=https\nhost=github.com\n\n',
                       stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=60)
    for ln in p.stdout.decode('utf-8', 'replace').splitlines():
        if ln.startswith('password='):
            return ln[len('password='):]
    raise SystemExit('取不到 GitHub 凭据（git credential fill 没返回 password）')


TOK = None


def api(method, path, body=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={
        'Authorization': 'token ' + TOK,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'workbuddy',
        'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode('utf-8', 'replace')[:400]
        raise SystemExit('%s %s 失败：HTTP %d %s' % (method, path, e.code, detail))


def iso(ts, tz):
    sign = 1 if tz[0] == '+' else -1
    off = datetime.timedelta(hours=int(tz[1:3]), minutes=int(tz[3:5])) * sign
    return datetime.datetime.fromtimestamp(int(ts), datetime.timezone(off)).isoformat()


def parse_commit(sha):
    """从本地 commit 对象里取 tree / parent / 作者信息 / message。"""
    raw = git('cat-file', '-p', sha)
    head, _, msg = raw.partition('\n\n')
    d = {'sha': sha, 'message': msg}
    for ln in head.splitlines():
        if ln.startswith('tree '):
            d['tree'] = ln[5:].strip()
        elif ln.startswith('parent '):
            d['parent'] = ln[7:].strip()
        elif ln.startswith('author ') or ln.startswith('committer '):
            role = 'author' if ln.startswith('author') else 'committer'
            m = re.match(r'^(\w+) (.*) <(.*)> (\d+) ([+-]\d{4})$', ln)
            if not m:
                raise SystemExit('解析不了这一行：%s' % ln)
            d[role] = {'name': m.group(2), 'email': m.group(3),
                       'date': iso(m.group(4), m.group(5))}
    return d


# ---------- 1. 远程现状 ----------
TOK = token()
log('凭据 OK（token %s…）' % TOK[:4])
ref = api('GET', '/repos/%s/git/ref/heads/%s' % (OWNER_REPO, BRANCH))
remote_sha = ref['object']['sha']
local_sha = git('rev-parse', 'HEAD').strip()
log('远程 %s: %s' % (BRANCH, remote_sha))
log('本地 HEAD : %s' % local_sha)
if remote_sha == local_sha:
    log('已经一致，无需推送 ✅')
    sys.exit(0)

todo = [c for c in git('rev-list', '--reverse', '%s..HEAD' % remote_sha).splitlines() if c.strip()]
if not todo:
    log('本地没有领先的提交')
    sys.exit(0)
log('待推提交 %d 个（旧 → 新）：' % len(todo))
for c in todo:
    log('   %s  %s' % (c[:7], git('log', '-1', '--format=%s', c).strip()[:56]))

if DRY:
    log('（--dry-run：到此为止）')
    sys.exit(0)

# ---------- 2. 逐个复刻 ----------
base_tree = api('GET', '/repos/%s/git/commits/%s' % (OWNER_REPO, remote_sha))['tree']['sha']
log('')
log('远程当前 tree: %s' % base_tree[:12])
parent = remote_sha
all_match = True

for c in todo:
    info = parse_commit(c)
    entries = []
    for ln in git('diff-tree', '--no-commit-id', '--name-status', '-r', c).splitlines():
        parts = ln.split('\t')
        if len(parts) < 2:
            continue
        status, path = parts[0][0], parts[-1]
        if status == 'D':
            entries.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': None})
            continue
        ls = git('ls-tree', c, path).split()
        mode = ls[0] if ls else '100644'
        local_blob = git('rev-parse', '%s:%s' % (c, path)).strip()
        # ★ 必须取**该提交里**的内容，不能读工作区文件：
        #   工作区是最新版（同一个文件可能已被后续提交改过），
        #   拿它上传会让 blob sha 对不上（v1 就是这样翻车的：README 在下一个提交里又改了，
        #   于是复刻 1355062 时上传了最新内容 → sha 不一致 → 整个提交复刻失败）。
        #   `git cat-file blob` 返回的是仓库里存的字节，二进制安全，也不受 CRLF 转换影响。
        pb = subprocess.run([GIT, '-C', ROOT, 'cat-file', 'blob', local_blob],
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        if pb.returncode != 0:
            raise SystemExit('取 %s 的 blob 失败：%s' % (local_blob, pb.stderr.decode('utf-8', 'replace')))
        content = pb.stdout
        b = api('POST', '/repos/%s/git/blobs' % OWNER_REPO,
                {'content': base64.b64encode(content).decode('ascii'), 'encoding': 'base64'})
        same = '✅' if b['sha'] == local_blob else '⚠️ blob sha 不同'
        log('  %s %-40s blob %s  %s' % (status, path[:40], b['sha'][:10], same))
        entries.append({'path': path, 'mode': mode, 'type': 'blob', 'sha': b['sha']})

    tree = api('POST', '/repos/%s/git/trees' % OWNER_REPO,
               {'base_tree': base_tree, 'tree': entries})
    log('  新 tree: %s（本地 %s）%s' % (tree['sha'][:12], info['tree'][:12],
                                   '✅' if tree['sha'] == info['tree'] else '⚠️ 不同'))

    newc = api('POST', '/repos/%s/git/commits' % OWNER_REPO, {
        'message': info['message'], 'tree': tree['sha'], 'parents': [parent],
        'author': info['author'], 'committer': info['committer']})
    match = newc['sha'] == c
    log('  新 commit: %s（本地 %s）%s' % (newc['sha'][:12], c[:12], '✅ 一致' if match else '❌ 不一致'))
    if not match:
        all_match = False
        log('     API 侧 message 前 60 字: %r' % newc['message'][:60])
        log('     本地 message 前 60 字  : %r' % info['message'][:60])
        break
    base_tree, parent = tree['sha'], newc['sha']

# ---------- 3. 只在完全一致时移动 ref ----------
log('')
if not all_match:
    log('❌ 复刻出来的 sha 与本地不一致 —— **没有移动 ref**，避免本地/远程分叉。')
    log('   远程仍是 %s；本地仍领先，等网络恢复用 git push 即可。' % remote_sha)
    sys.exit(2)

api('PATCH', '/repos/%s/git/refs/heads/%s' % (OWNER_REPO, BRANCH),
    {'sha': parent, 'force': True})
log('已把远程 %s 移到 %s' % (BRANCH, parent[:12]))

# ---------- 4. 独立核对 ----------
chk = api('GET', '/repos/%s/git/ref/heads/%s' % (OWNER_REPO, BRANCH))
log('远程现在: %s' % chk['object']['sha'])
log('本地 HEAD : %s' % local_sha)
log('一致: %s' % ('✅' if chk['object']['sha'] == local_sha else '❌'))

with open(os.path.join(ROOT, '.workbuddy', 'tmp', 'push_via_api.txt'), 'w',
          encoding='utf-8') as f:
    f.write('\n'.join(OUT))
