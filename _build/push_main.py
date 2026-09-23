# -*- coding: utf-8 -*-
"""推送 main 到 GitHub —— 用 Python 而不是 PowerShell。

原因：这条链路在 PowerShell 里反复出问题（解析、PATH、凭据 helper 要 spawn sh），
Python 侧可控得多：显式设 env、token 只放进本次 URL、输出前脱敏、最后用 API 核对。

用法：python _build/push_main.py
"""
import json
import os
import subprocess
import sys

ROOT = r'D:\workspaces\WorkBuddy\小悦饼知识库'
GIT_DIRS = r'D:\Application\Git\mingw64\bin;D:\Application\Git\usr\bin;D:\Application\Git\cmd'
REMOTE = 'github.com/zhaorendong/kid-learning-workbench.git'

OUT = []


def log(*a):
    line = ' '.join(str(x) for x in a)
    OUT.append(line)
    print(line, flush=True)


env = dict(os.environ)
env['PATH'] = GIT_DIRS + ';' + env.get('PATH', '')
env['GIT_TERMINAL_PROMPT'] = '0'


def git(*args, **kw):
    p = subprocess.run(['git', '-C', ROOT] + list(args), env=env,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       timeout=kw.pop('timeout', 300))
    return p.returncode, p.stdout.decode('utf-8', 'replace')


# ---------- 1. 取凭据 ----------
p = subprocess.run(['git', 'credential', 'fill'], env=env,
                   input=b'protocol=https\nhost=github.com\n\n',
                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
token = user = ''
for ln in p.stdout.decode('utf-8', 'replace').splitlines():
    if ln.startswith('password='):
        token = ln[len('password='):]
    elif ln.startswith('username='):
        user = ln[len('username='):]
if not token:
    log('! 取不到凭据（credential fill 返回码 %d）：%s'
        % (p.returncode, p.stderr.decode('utf-8', 'replace')[:200]))
    log('  请确认本机凭据管理器里有 github.com 的凭据。')
    sys.exit(1)
log('凭据 OK（user=%s, token=%s…，长度 %d）' % (user or '?', token[:4], len(token)))

# ---------- 2. 本地状态 ----------
rc, cur = git('rev-parse', '--abbrev-ref', 'HEAD')
rc, local = git('rev-parse', 'HEAD')
log('本地分支 %s / HEAD %s' % (cur.strip(), local.strip()))

rc, st = git('status', '--porcelain')
if st.strip():
    log('! 工作区还没提交干净：')
    log(st.strip()[:500])
else:
    log('工作区干净 ✅')

# ---------- 3. 推送 ----------
url = 'https://%s:%s@%s' % (user or 'zhaorendong', token, REMOTE)
pushed = False
for i in range(1, 4):
    rc, out = git('push', url, 'main', timeout=300)
    shown = out.replace(token, '***')
    if rc == 0 and ('main -> main' in out or 'up-to-date' in out or 'Everything up-to-date' in out):
        log('push 成功（第 %d 次）' % i)
        for ln in shown.strip().splitlines():
            log('  ' + ln)
        pushed = True
        break
    log('尝试 %d 次失败：' % i)
    for ln in shown.strip().splitlines()[:4]:
        log('  ' + ln)
    import time
    time.sleep(3)
if not pushed:
    log('! 三次都没成功')

# ---------- 4. 用 API 核对（不依赖 git 传输）----------
log('')
log('--- 用 API 核对远程（git fetch 走不通，只能查 API）---')
try:
    import urllib.request
    req = urllib.request.Request(
        'https://api.github.com/repos/zhaorendong/kid-learning-workbench/git/ref/heads/main',
        headers={'Authorization': 'token ' + token,
                 'Accept': 'application/vnd.github+json',
                 'User-Agent': 'workbuddy'})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.load(r)
    remote = data['object']['sha']
    log('远程 main : %s' % remote)
    log('本地 HEAD : %s' % local.strip())
    log('一致: %s' % ('✅' if remote == local.strip() else '❌ 不一致！'))
    # 顺手确认新脚本在远程
    req2 = urllib.request.Request(
        'https://api.github.com/repos/zhaorendong/kid-learning-workbench/contents/_build/push_main.py',
        headers={'Authorization': 'token ' + token,
                 'Accept': 'application/vnd.github+json', 'User-Agent': 'workbuddy'})
    try:
        with urllib.request.urlopen(req2, timeout=30) as r:
            log('远程已有 _build/push_main.py: ✅ %d B' % json.load(r)['size'])
    except Exception as e:
        log('远程还没有 _build/push_main.py（本次新增，推成功后就有）: %s' % e)
except Exception as e:
    log('API 核对失败：%r' % (e,))
