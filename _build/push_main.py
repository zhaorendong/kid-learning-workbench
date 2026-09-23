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


def _port_open(host, port, timeout=1.0):
    """探测端口是否真的在监听。

    注意：**TCP connect 成功不等于能传数据** —— 被干扰的网络会对 SYN 回一个
    "假"握手，之后 TLS/HTTP 才失败。所以这里只用来判断"代理进程在不在"，
    不能用来断言 github.com 可达。
    """
    import socket
    s = socket.socket()
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        return True
    except Exception:
        return False
    finally:
        try:
            s.close()
        except Exception:
            pass


#: 代理处理：这台机器访问 github.com **依赖代理**
#: （直连会卡 20 秒后 `Couldn't connect to server`，但 `api.github.com` 是通的）。
#: 而代理是波动的 —— 环境变量里的 `HTTP(S)_PROXY` 有时指向一个**已经死掉的本地端口**，
#: git 照着走就报 `CONNECT tunnel failed, response 502`。
#: 所以：**先探代理端口活不活，活着才用；不活就摘掉（免得白等 20 秒超时）**。
_proxy, _src = os.environ.get('XYB_GIT_PROXY'), 'XYB_GIT_PROXY'
if not _proxy:
    for _k in ('HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'):
        if os.environ.get(_k):
            _proxy, _src = os.environ[_k], _k
            break

_use_proxy = False
if _proxy:
    from urllib.parse import urlparse as _urlparse
    _u = _urlparse(_proxy)
    _ph, _pp = _u.hostname or '127.0.0.1', _u.port or 80
    if _port_open(_ph, _pp):
        _use_proxy = True
        log('代理 %s（来自 %s）在监听 → 走代理' % (_proxy, _src))
    else:
        log('! 环境里的代理 %s（来自 %s）**没有在监听** → 忽略它' % (_proxy, _src))

for _k in ('HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy',
           'ALL_PROXY', 'all_proxy', 'NO_PROXY', 'no_proxy'):
    env.pop(_k, None)
if _use_proxy:
    env['HTTP_PROXY'] = env['HTTPS_PROXY'] = _proxy
    log('  已按上面的代理设置注入 git 环境')
else:
    log('  已摘掉全部代理变量，将尝试直连')
    log('  （直连大概率不通，实测要卡 20 秒 —— 若失败请先启动代理再重跑）')


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
