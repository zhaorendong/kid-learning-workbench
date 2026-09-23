# -*- coding: utf-8 -*-
"""把 videos/ 上传到部署机 —— 视频体积大，单独走这条通道。

为什么不并进 deploy_pcc.py：
    静态站那 21 个文件是"手写清单 + 全量重传"，每次几百 KB；
    视频动辄几十上百 MB，必须**增量**（已存在的跳过），而且不进 git 仓库
    （体积 + 版权）。两者节奏完全不同，分开更清楚。

用法：
    python _build/deploy_videos.py                # 增量上传（默认）
    python _build/deploy_videos.py --force        # 全部重传
    python _build/deploy_videos.py --dry-run      # 只看要传什么（不连服务器）
    python _build/deploy_videos.py --prune        # 顺手删掉远端多出来的视频
    python _build/deploy_videos.py --no-index     # 不重新生成清单，直接传

上传前会先跑一次 build_video_index.py，保证清单和实际文件一致。
"""
import argparse
import hashlib
import os
import re
import subprocess
import sys
import time

import site_config
from site_config import CFG

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
VIDEO_DIR = os.path.join(ROOT, 'videos')
REMOTE_ROOT = CFG['remote_site_dir']
REMOTE_VIDEO = REMOTE_ROOT + '\\videos'
VIDEO_EXT = ('.mp4', '.m4v', '.webm', '.mov')

OUT = []


def log(*a):
    line = ' '.join(str(x) for x in a)
    OUT.append(line)
    print(line)


def sha256_local(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def local_files():
    """返回 {相对 videos/ 的 posix 路径: 绝对路径}"""
    out = {}
    for dirpath, _d, fnames in os.walk(VIDEO_DIR):
        for fn in fnames:
            if not fn.lower().endswith(VIDEO_EXT):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, VIDEO_DIR).replace('\\', '/')
            out[rel] = full
    return out


def run_index():
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'build_video_index.py')
    log('--- 先重新生成视频清单 ---')
    r = subprocess.run([sys.executable, p], stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, cwd=ROOT)
    text = r.stdout.decode('utf-8', 'replace')
    for line in text.strip().splitlines()[-8:]:
        log('  ' + line)
    if r.returncode != 0:
        log('! 清单生成失败（exit=%d），中止' % r.returncode)
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true', help='全部重传，不跳过')
    ap.add_argument('--dry-run', action='store_true', help='只列清单，不连服务器')
    ap.add_argument('--prune', action='store_true', help='删除远端多出来的视频')
    ap.add_argument('--no-index', action='store_true', help='不重新生成清单')
    args = ap.parse_args()

    if not args.no_index:
        run_index()

    if not os.path.isdir(VIDEO_DIR):
        log('! 没有 videos/ 目录。先建它，并在里面按学科建子目录：')
        log('    videos/语文/01-拼音儿歌.mp4')
        return 1

    files = local_files()
    if not files:
        log('! videos/ 里一个视频都没有（支持 %s）' % ', '.join(VIDEO_EXT))
        return 1

    total_bytes = sum(os.path.getsize(p) for p in files.values())
    log('')
    log('本地视频 %d 个，合计 %.1f MB' % (len(files), total_bytes / 1048576.0))
    for rel, full in sorted(files.items()):
        log('  %-52s %9.1f MB' % (rel, os.path.getsize(full) / 1048576.0))

    if args.dry_run:
        log('')
        log('（--dry-run：不连接部署机）')
        write_log()
        return 0

    if site_config.is_placeholder():
        log('')
        log('! ' + site_config.MISSING_CRED_HINT)
        write_log()
        return 1

    cli = site_config.ssh_connect()
    log('')
    log('=== SSH 已连接部署机 (%s) ===' % CFG['host'])

    def run(cmd, timeout=300):
        _, so, se = cli.exec_command(cmd, timeout=timeout)
        return (so.read().decode('gbk', 'replace'), se.read().decode('gbk', 'replace'))

    # 建目录
    run('if not exist "%s" mkdir "%s"' % (REMOTE_VIDEO, REMOTE_VIDEO))
    for sub in sorted({rel.split('/')[0] for rel in files}):
        p = REMOTE_VIDEO + '\\' + sub
        run('if not exist "%s" mkdir "%s"' % (p, p))
    log('  远端目录已就绪：%s' % REMOTE_VIDEO)

    # 远端现有文件（一次性取回，避免逐个往返）
    o, _ = run('powershell -NoProfile -Command "'
               'if (Test-Path -LiteralPath \'%s\') { '
               'Get-ChildItem -LiteralPath \'%s\' -Recurse -File | '
               'ForEach-Object { $_.FullName.Substring(%d) + \'|\' + $_.Length } }"'
               % (REMOTE_VIDEO, REMOTE_VIDEO, len(REMOTE_VIDEO) + 1), timeout=120)
    remote = {}
    for line in o.splitlines():
        line = line.strip()
        if '|' in line:
            rel, _, size = line.rpartition('|')
            rel = rel.strip().replace('\\', '/').lstrip('/')
            try:
                remote[rel] = int(size.strip())
            except ValueError:
                pass
    log('  远端现有 %d 个文件' % len(remote))

    # 决定传哪些
    todo, skip = [], []
    for rel, full in sorted(files.items()):
        sz = os.path.getsize(full)
        if not args.force and remote.get(rel) == sz:
            skip.append(rel)
        else:
            todo.append(rel)

    log('')
    log('--- 上传计划 ---')
    log('  跳过（已存在且大小一致）：%d 个' % len(skip))
    log('  需要上传：%d 个  (%.1f MB)' % (len(todo), sum(os.path.getsize(files[r]) for r in todo) / 1048576.0))
    if not todo:
        log('  没有需要上传的文件。')

    sftp = cli.open_sftp() if todo else None
    uploaded, mismatch = 0, []
    for rel in todo:
        full = files[rel]
        rp = REMOTE_VIDEO + '\\' + rel.replace('/', '\\')
        # 确保中间目录存在（学科子目录已建，防止更深层嵌套时漏建）
        parent = os.path.dirname(rp)
        if parent:
            run('if not exist "%s" mkdir "%s"' % (parent, parent))
        t0 = time.time()
        try:
            sftp.put(full, rp)
        except Exception as e:
            log('  ✗ %-50s 上传失败：%r' % (rel, e))
            mismatch.append((rel, 'upload-failed'))
            continue
        dt = time.time() - t0
        speed = os.path.getsize(full) / 1048576.0 / dt if dt > 0 else 0
        log('  ↑ %-50s %8.1f MB  %.1fs (%.1f MB/s)'
            % (rel, os.path.getsize(full) / 1048576.0, dt, speed))
        uploaded += 1
    if sftp:
        sftp.close()

    # 校验 sha256（大文件也快，值得做 —— 截断是最难发现的坑）
    if uploaded:
        log('')
        log('--- 校验 sha256 ---')
        for rel in todo:
            full = files[rel]
            if any(m[0] == rel for m in mismatch):
                continue
            rp = REMOTE_VIDEO + '\\' + rel.replace('/', '\\')
            o, _ = run('certutil -hashfile "%s" SHA256' % rp, timeout=300)
            rhash = ''
            for line in o.splitlines():
                s = line.strip().replace(' ', '')
                if len(s) == 64 and re.fullmatch(r'[0-9a-fA-F]{64}', s):
                    rhash = s.lower()
                    break
            lh = sha256_local(full)
            ok = (rhash == lh)
            log('  %s %-50s %s' % ('OK  ' if ok else 'DIFF', rel, lh[:16]))
            if not ok:
                mismatch.append((rel, 'sha256: remote=%s local=%s' % (rhash, lh)))

    # 远端多出来的（本地已删）
    extra = sorted(set(remote) - set(files))
    if extra:
        log('')
        log('--- 远端有、本地没有的（%d 个）---' % len(extra))
        for rel in extra[:20]:
            log('  ? %s' % rel)
        if len(extra) > 20:
            log('  ... 其余 %d 个' % (len(extra) - 20))
        if args.prune:
            log('  --prune：正在删除…')
            for rel in extra:
                rp = REMOTE_VIDEO + '\\' + rel.replace('/', '\\')
                run('del /f /q "%s"' % rp)
            log('  已删除 %d 个' % len(extra))
        else:
            log('  （要清理就加 --prune；不加就留着，不会影响使用）')

    # HTTP 抽查
    log('')
    log('--- 线上抽查 ---')
    base = 'http://%s:%d' % (CFG['host'], int(CFG['web_port']))
    try:
        import urllib.parse
        import urllib.request
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for rel in list(files)[:3]:
            url = base + '/videos/' + urllib.parse.quote(rel)
            try:
                rq = urllib.request.Request(url, method='HEAD')
                with op.open(rq, timeout=20) as r:
                    log('  %-50s status=%d bytes=%s' % (rel, r.status, r.headers.get('Content-Length')))
            except Exception as e:
                log('  %-50s FAIL %s' % (rel, e))
    except Exception as e:
        log('  抽查异常: %r' % (e,))

    log('')
    log('===== 结论 =====')
    log('  上传 %d 个 / 跳过 %d 个 / 校验不符 %d 个' % (uploaded, len(skip), len(mismatch)))
    for rel, why in mismatch:
        log('    !! %s  %s' % (rel, why))
    log('  视频地址示例：%s/videos/%s' % (base, list(files)[0]))

    cli.close()
    write_log()
    return 0 if not mismatch else 2


def write_log():
    with open(os.path.join(ROOT, '_build', 'deploy_videos.log'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(OUT))


if __name__ == '__main__':
    sys.exit(main())
