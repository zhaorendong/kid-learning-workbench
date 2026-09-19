# -*- coding: utf-8 -*-
"""部署前探测：连通性 / 端口 / 镜像 / 目录。输出写日志文件，供人工 Read。

目标地址与账号来自 `_build/site_config.py`（真实值放 site.local.json，不进仓库）。
"""
import io
import socket
import sys

import site_config
from site_config import CFG

OUT = []


def log(*a):
    OUT.append(' '.join(str(x) for x in a))


log('===== 1. 本机 -> 部署机 TCP 连通性 =====')
for host, port, name in [(CFG['host_lan'], int(CFG['ssh_port']), '局域网'),
                         (CFG['host'], int(CFG['ssh_port']), 'VPN')]:
    s = socket.socket()
    s.settimeout(4)
    try:
        s.connect((host, port))
        log('  OK   %-8s %s:%d' % (name, host, port))
    except Exception as e:
        log('  FAIL %-8s %s:%d  %s' % (name, host, port, e))
    finally:
        s.close()

if site_config.is_placeholder():
    log('\n! ' + site_config.MISSING_CRED_HINT)
    open('_build/probe.log', 'w', encoding='utf-8').write('\n'.join(OUT))
    sys.exit(1)

USER = CFG['ssh_user']
cli = None
HOST_USED = None
for host in (CFG['host'], CFG['host_lan']):
    try:
        cli, HOST_USED = site_config.ssh_connect(host, timeout=15), host
        log('\n[OK] SSH 已连接 via %s (%s)' % (host, USER))
        break
    except Exception as e:
        log('\n[FAIL] SSH %s -> %s: %s' % (host, type(e).__name__, e))

if not cli:
    open('_build/probe.log', 'w', encoding='utf-8').write('\n'.join(OUT))
    sys.exit(2)


def run(cmd, timeout=90):
    _, so, se = cli.exec_command(cmd, timeout=timeout)
    o = so.read().decode('gbk', 'replace')
    e = se.read().decode('gbk', 'replace')
    return o, e


log('\n===== 2. 远端基本信息 =====')
o, _ = run('hostname && whoami')
log(o.strip())

log('\n===== 3. 已监听端口 =====')
o, e = run('netstat -ano | findstr LISTENING')
ports = set()
for line in o.splitlines():
    parts = line.split()
    if len(parts) >= 2 and ':' in parts[1]:
        try:
            ports.add(int(parts[1].rsplit(':', 1)[1]))
        except ValueError:
            pass
log('  监听端口数: %d' % len(ports))
log('  端口列表: %s' % ','.join(str(p) for p in sorted(ports)))
for cand in (8000, 8099, 8686, 9099, 9999, 8888, 8081, 8899, 18080):
    log('  候选 %-6d %s' % (cand, '空闲 ✅' if cand not in ports else '已占用 ❌'))

log('\n===== 4. Docker 与镜像 =====')
o, e = run('docker version --format "{{.Server.Version}}"')
log('  docker server: %s' % (o.strip() or '(空)'))
o, e = run('docker images --format "{{.Repository}}:{{.Tag}}"')
imgs = [x.strip() for x in o.splitlines() if x.strip()]
log('  本地镜像 %d 个: %s' % (len(imgs), ', '.join(imgs)))
log('  nginx:alpine = %s' % ('在 ✅' if any(i.startswith('nginx:alpine') for i in imgs) else '不在 ❌'))

log('\n===== 5. 目录与已有容器 =====')
o, e = run('if exist "%s" (echo EXISTS) else (echo MISSING)' % CFG['remote_site_dir'])
log('  站点目录 %s : %s' % (CFG['remote_site_dir'], o.strip()))
o, e = run('if exist "%s" (echo EXISTS) else (echo MISSING)' % CFG['remote_conf_dir'])
log('  配置目录 %s : %s' % (CFG['remote_conf_dir'], o.strip()))
o, e = run('docker ps -a --filter "name=%s" --format "{{.Names}} {{.Status}} {{.Ports}}"'
           % CFG['site_container'])
log('  同名容器: %s' % (o.strip() or '(无)'))
o, e = run('docker ps --format "{{.Names}} {{.Ports}}"')
log('  运行中容器:\n    ' + '\n    '.join(o.strip().splitlines()) if o.strip() else '  运行中容器: (无)')

cli.close()
open('_build/probe.log', 'w', encoding='utf-8').write('\n'.join(OUT))
print('done')
