# -*- coding: utf-8 -*-
"""把数据服务部署到 PC-C：
   上传 server.py → 建计划任务（onstart / SYSTEM，免登录自启）→ 启动 → 验活。
   可重复执行（先杀旧任务再建）。输出 _build/deploy_server.log"""
import json
import os
import time
import urllib.error
import urllib.request

import site_config
from site_config import CFG

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
REMOTE_DIR = CFG['remote_server_dir']
DATA_DIR = CFG['remote_data_dir']
PORT = int(CFG['api_port'])
TASK = CFG['task_name']
PY = CFG['remote_python']

OUT = []


def log(*a):
    line = ' '.join(str(x) for x in a)
    OUT.append(line)
    print(line)


INSTALL_BAT = '''@echo off
set PY={py}
set SRV={srv}
schtasks /end /tn {task} >nul 2>&1
schtasks /delete /tn {task} /f >nul 2>&1
schtasks /create /tn {task} /tr "\\"%PY%\\" \\"%SRV%\\" --port {port} --data \\"{data}\\"" /sc onstart /ru SYSTEM /rl HIGHEST /f
if errorlevel 1 echo CREATE-FAILED
schtasks /run /tn {task}
if errorlevel 1 echo RUN-FAILED
timeout /t 2 /nobreak >nul
echo INSTALL-DONE
'''.format(py=PY, srv=REMOTE_DIR + r'\server.py', task=TASK, port=PORT, data=DATA_DIR)


cli = site_config.ssh_connect()
log('=== SSH 已连接部署机 (%s) ===\n' % CFG['host'])


def run(cmd, timeout=180):
    _, so, se = cli.exec_command(cmd, timeout=timeout)
    return so.read().decode('gbk', 'replace'), se.read().decode('gbk', 'replace')


def ping(url, timeout=6):
    try:
        op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with op.open(url, timeout=timeout) as r:
            return json.loads(r.read().decode('utf-8'))
    except Exception as e:
        return {'_error': str(e)}


log('===== 1. 目录与文件 =====')
run('if not exist "%s" mkdir "%s"' % (REMOTE_DIR, REMOTE_DIR))
run('if not exist "%s" mkdir "%s"' % (DATA_DIR, DATA_DIR))
sftp = cli.open_sftp()
sftp.put(os.path.join(ROOT, '_build', 'server', 'server.py'), REMOTE_DIR + r'\server.py')
with sftp.open(REMOTE_DIR + r'\install_service.bat', 'w') as f:
    f.write(INSTALL_BAT)
sftp.close()
log('  已上传 server.py 与 install_service.bat')

log('\n===== 2. 建计划任务并启动 =====')
o, e = run(r'"%s\install_service.bat"' % REMOTE_DIR, timeout=120)
for line in (o + e).strip().splitlines():
    log('  ' + line.strip())

time.sleep(3)

log('\n===== 3. 计划任务状态 =====')
o, _ = run('schtasks /query /tn %s /fo LIST' % TASK)
for line in o.strip().splitlines():
    if line.strip():
        log('  ' + line.strip())
o, _ = run('schtasks /query /tn %s /v /fo LIST | findstr /i "运行方式 计划类型 状态 上次运行结果"' % TASK)
for line in o.strip().splitlines():
    log('  ' + line.strip())

log('\n===== 4. 端口监听 =====')
o, _ = run('netstat -ano | findstr LISTENING | findstr :%d' % PORT)
log('  %s' % (o.strip() or '（未见 %d 在监听）' % PORT))

log('\n===== 5. 服务自评（部署机本机 / 局域网 / VPN）=====')
for host in ('127.0.0.1', CFG['host_lan'], CFG['host']):
    o, _ = run('powershell -NoProfile -Command "'
               'try { (Invoke-WebRequest -UseBasicParsing -Uri \'http://%s:%d/api/ping\' -TimeoutSec 8).Content }'
               ' catch { \'ERR \' + $_.Exception.Message }"' % (host, PORT), timeout=60)
    log('  %-15s : %s' % (host, o.strip()))

log('\n===== 6. 从本机（经 VPN）访问 =====')
_api = 'http://%s:%d/api/ping' % (CFG['host'], PORT)
log('  %s -> %s' % (_api, ping(_api)))

log('\n===== 7. 数据目录 =====')
o, _ = run('dir /b "%s"' % DATA_DIR)
log('  %s' % (o.strip() or '(空)'))
o, _ = run('type "%s\\meta.json" 2>nul' % DATA_DIR)
log('  meta.json: %s' % (o.strip() or '(还没有，首次写入后生成)'))

cli.close()
open(os.path.join(ROOT, '_build', 'deploy_server.log'), 'w', encoding='utf-8').write('\n'.join(OUT))
print('DONE')
