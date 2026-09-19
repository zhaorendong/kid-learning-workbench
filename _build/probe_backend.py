# -*- coding: utf-8 -*-
"""探测 PC-C 上做「服务端存储」的可行手段：
   nginx 是否带 dav 模块 / autoindex json、能否写挂载目录、宿主 Python 情况。"""
import site_config

OUT = []
c = site_config.ssh_connect()


def run(cmd, timeout=120):
    _, so, se = c.exec_command(cmd, timeout=timeout)
    return (so.read().decode('gbk', 'replace'), se.read().decode('gbk', 'replace'))


OUT.append('===== 1. nginx:alpine 编译选项（找 dav / autoindex）=====')
o, e = run('docker run --rm nginx:alpine nginx -V 2>&1')
txt = (o + e)
for kw in ('http_dav_module', 'http_auth_basic_module', 'http_autoindex_module',
           'http_slice_module', 'http_ssl_module'):
    OUT.append('  %-28s %s' % (kw, 'YES ✅' if kw in txt else 'NO ❌'))
OUT.append('  --- 完整 configure arguments ---')
for line in txt.splitlines():
    if 'configure arguments' in line:
        OUT.append('  ' + line.strip())

OUT.append('\n===== 2. 运行中容器 xiaoyuebing 的挂载（只读？）=====')
o, _ = run('docker inspect xiaoyuebing --format "{{range .Mounts}}{{.Mode}} {{.Source}} -> {{.Destination}}{{println}}{{end}}"')
OUT.append(o.strip() or '(空)')

OUT.append('\n===== 3. 宿主 Python =====')
o, _ = run('python --version 2>&1')
OUT.append('  python --version      : %s' % o.strip())
o, _ = run('where python 2>&1')
OUT.append('  where python          : %s' % ' | '.join(o.strip().splitlines()))
o, _ = run('py -0 2>&1')
OUT.append('  py -0                 : %s' % ' | '.join(o.strip().splitlines()))
o, _ = run('python -c "import sys,json,http.server,sqlite3;print(sys.version);print(sys.executable)" 2>&1')
OUT.append('  标准库可用性          : %s' % ' | '.join(o.strip().splitlines()))

OUT.append('\n===== 4. 空闲端口（服务端 API 用）=====')
o, _ = run('netstat -ano | findstr LISTENING')
ports = set()
for line in o.splitlines():
    parts = line.split()
    if len(parts) >= 2 and ':' in parts[1]:
        try:
            ports.add(int(parts[1].rsplit(':', 1)[1]))
        except ValueError:
            pass
for cand in (8100, 8101, 8787, 9099, 8686, 9999, 9080, 7080):
    OUT.append('  %-6d %s' % (cand, '空闲 ✅' if cand not in ports else '已占用 ❌'))

OUT.append('\n===== 5. 数据目录可写性 =====')
o, _ = run('if exist "C:\\workspace\\xiaoyuebing-data" (echo EXISTS) else (echo MISSING)')
OUT.append('  C:\\workspace\\xiaoyuebing-data : %s' % o.strip())
o, e = run('mkdir "C:\\workspace\\xiaoyuebing-data\\probe" 2>&1 && '
           'echo hello> "C:\\workspace\\xiaoyuebing-data\\probe\\t.txt" && '
           'type "C:\\workspace\\xiaoyuebing-data\\probe\\t.txt" && '
           'del "C:\\workspace\\xiaoyuebing-data\\probe\\t.txt" && '
           'rmdir "C:\\workspace\\xiaoyuebing-data\\probe" && echo WRITE-OK')
OUT.append('  读写测试 : %s' % (o.strip() or e.strip()))

OUT.append('\n===== 6. 计划任务能力（免登录自启，看能否绕过 Docker 重启需登录）=====')
o, e = run('schtasks /query /tn "XYBProbeNoSuch" 2>&1')
OUT.append('  schtasks 可用 : %s' % (o.strip() or e.strip())[:160])
o, _ = run('whoami /groups | findstr /i "S-1-5-32-544"')
OUT.append('  是否管理员组 : %s' % (o.strip()[:120] or '(不在 Administrators)'))

OUT.append('\n===== 7. 现有容器全貌 =====')
o, _ = run('docker ps -a --format "{{.Names}} | {{.Status}} | {{.Ports}}"')
for line in o.strip().splitlines():
    OUT.append('  ' + line)

c.close()
open('_build/probe_backend.log', 'w', encoding='utf-8').write('\n'.join(OUT))
print('done')
