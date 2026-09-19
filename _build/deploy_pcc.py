# -*- coding: utf-8 -*-
"""把整站上传到部署机（PC-C）并重建 nginx 容器。

连接地址、账号、端口都不写死在这里 —— 见 `_build/site_config.py`
（真实值放 `_build/site.local.json`，不进仓库；也可用环境变量提供）。
所有输出写 `_build/deploy.log`。
"""
import hashlib
import os
import re
import sys
import time

import site_config
from site_config import CFG

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
REMOTE_ROOT = CFG['remote_site_dir']
REMOTE_CONF = CFG['remote_conf_dir']
PORT = int(CFG['web_port'])
NAME = CFG['site_container']

OUT = []


def log(*a):
    line = ' '.join(str(x) for x in a)
    OUT.append(line)
    print(line)


# ---- 要上传的文件（相对路径）。刻意排除：.workbuddy/、_build/、docs/、
#      一年级数独/_build/、91 个 mp3（音频已 base64 内嵌进 HTML） ----
FILES = [
    'index.html',
    'parent.html',
    'manifest.webmanifest',
    'assets/app.css',
    'assets/catalog.js',
    'assets/core.js',
    'assets/icon.svg',
    'assets/parent.js',
    'assets/student.js',
    'assets/sync.js',
    'assets/xyb-sdk.js',
    'modules/_template/index.html',
    'modules/_template/module.json',
    'modules/math-calc/index.html',
    'modules/math-calc/module.json',
    'modules/pinyin-1/index.html',
    'modules/pinyin-1/audio.js',
    'modules/pinyin-1/module.json',
    '一年级数独/一年级数独入门教程.html',
    '一年级数独/一年级数独题库（可打印）.docx',
]

DIRS = ['', 'assets', 'modules', 'modules\\_template', 'modules\\math-calc',
        'modules\\pinyin-1', '一年级数独']

NGINX_CONF = """server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # 让浏览器每次回源校验；有 ETag，没变就是 304，代价很小
    add_header Cache-Control "no-cache, must-revalidate" always;

    # 中文目录名直接用，不需要额外配置；这里只处理 SPA 式的直接访问
    location / {
        try_files $uri $uri/ =404;
    }
}
"""


def sha256_local(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


cli = site_config.ssh_connect()
log('=== SSH 已连接部署机 (%s) ===\n' % CFG['host'])


def run(cmd, timeout=180):
    _, so, se = cli.exec_command(cmd, timeout=timeout)
    o = so.read().decode('gbk', 'replace')
    e = se.read().decode('gbk', 'replace')
    return o, e


log('===== 1. 建目录 =====')
for d in DIRS:
    p = REMOTE_ROOT + ('\\' + d if d else '')
    run('if not exist "%s" mkdir "%s"' % (p, p))
run('if not exist "%s" mkdir "%s"' % (REMOTE_CONF, REMOTE_CONF))
log('  已就绪: %s（含 %d 个子目录）+ %s' % (REMOTE_ROOT, len(DIRS) - 1, REMOTE_CONF))

log('\n===== 2. 上传文件 =====')
sftp = cli.open_sftp()
total = 0
mismatch = []
for rel in FILES:
    lp = os.path.join(ROOT, rel.replace('/', os.sep))
    if not os.path.exists(lp):
        log('  ! 本地缺失，跳过: %s' % rel)
        mismatch.append((rel, 'LOCAL-MISSING'))
        continue
    rp = REMOTE_ROOT + '\\' + rel.replace('/', '\\')
    size = os.path.getsize(lp)
    t0 = time.time()
    sftp.put(lp, rp)
    total += size
    log('  ↑ %-46s %9d B  %.1fs' % (rel, size, time.time() - t0))

log('\n  conf 文件:')
rp_conf = REMOTE_CONF + '\\default.conf'
with sftp.open(rp_conf, 'w') as f:
    f.write(NGINX_CONF)
log('  ↑ %s' % rp_conf)

sftp.close()
log('  合计上传 %.2f MB' % (total / 1048576.0))

log('\n===== 3. 校验 sha256（远端 vs 本地）=====')
for rel in FILES:
    lp = os.path.join(ROOT, rel.replace('/', os.sep))
    if not os.path.exists(lp):
        continue
    rp = REMOTE_ROOT + '\\' + rel.replace('/', '\\')
    o, _ = run('certutil -hashfile "%s" SHA256' % rp, timeout=120)
    remote_hash = ''
    for line in o.splitlines():
        s = line.strip().replace(' ', '')
        if len(s) == 64 and re.fullmatch(r'[0-9a-fA-F]{64}', s):
            remote_hash = s.lower()
            break
    lh = sha256_local(lp)
    okflag = 'OK  ' if remote_hash == lh else 'DIFF'
    if remote_hash != lh:
        mismatch.append((rel, 'remote=%s local=%s' % (remote_hash, lh)))
    log('  %s %-46s %s' % (okflag, rel, lh[:16]))

log('\n===== 4. 起容器 =====')
o, e = run('docker rm -f %s' % NAME)
log('  rm -f: %s' % (o.strip() or e.strip() or '(无输出)'))

cmd = ('docker run -d --name %s --restart unless-stopped -p %d:80 '
       '-v "%s:/usr/share/nginx/html:ro" '
       '-v "%s\\default.conf:/etc/nginx/conf.d/default.conf:ro" '
       'nginx:alpine') % (NAME, PORT, REMOTE_ROOT, REMOTE_CONF)
o, e = run(cmd)
log('  run: %s' % (o.strip() or e.strip()))

time.sleep(3)
o, _ = run('docker exec %s nginx -t' % NAME)
log('  nginx -t: %s' % ' / '.join(x.strip() for x in o.splitlines() if x.strip()))
o, _ = run('docker ps --filter "name=%s" --format "{{.Names}} | {{.Status}} | {{.Ports}}"' % NAME)
log('  容器状态: %s' % o.strip())

log('\n===== 5. HTTP 验证 =====')
# 在部署机本机打自己的两个地址，证明监听与绑定都有效
CHECKS = [
    ('本机打局域网 IP', 'http://%s:%d/' % (CFG['host_lan'], PORT)),
    ('本机打 VPN IP', 'http://%s:%d/' % (CFG['host'], PORT)),
]
for label, url in CHECKS:
    o, e = run('powershell -NoProfile -Command "'
               '(Invoke-WebRequest -UseBasicParsing -Uri \'%s\' -TimeoutSec 10).StatusCode"'
               % url, timeout=90)
    log('  %-18s %-28s -> %s %s' % (label, url, o.strip() or '(空)', e.strip()[:120]))

# 远端直接取响应头与特征串
o, _ = run('powershell -NoProfile -Command "'
           '$r = Invoke-WebRequest -UseBasicParsing -Uri \'http://127.0.0.1:%d/\' -TimeoutSec 10;'
           'Write-Output (\'status=\' + $r.StatusCode);'
           'Write-Output (\'len=\' + $r.RawContentLength);'
           'Write-Output (\'cache=\' + $r.Headers[\'Cache-Control\']);'
           'Write-Output (\'hit=\' + ($r.Content -match \'小悦饼\'))"' % PORT, timeout=90)
log('  远端自测: %s' % ' | '.join(x.strip() for x in o.splitlines() if x.strip()))

from urllib.parse import quote as _quote

for path, needle in [('/parent.html', '家长'), ('/assets/core.js', 'XYB'),
                     ('/assets/sync.js', 'XYBSync'),
                     ('/modules/pinyin-1/index.html', '拼音'),
                     ('/modules/math-calc/index.html', '口算'),
                     ('/一年级数独/一年级数独入门教程.html', '数独')]:
    esc = _quote(path)
    o, _ = run('powershell -NoProfile -Command "'
               '$r = Invoke-WebRequest -UseBasicParsing -Uri \'http://127.0.0.1:%d%s\' -TimeoutSec 15;'
               'Write-Output ($r.StatusCode.ToString() + \' len=\' + $r.RawContentLength)"'
               % (PORT, esc), timeout=120)
    log('  %-44s -> %s' % (path, o.strip() or '(空)'))

log('\n===== 6. 本地侧 HTTP 验证（经 VPN）=====')
try:
    import urllib.request
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    base = 'http://%s:%d' % (CFG['host'], PORT)
    for url in (base + '/',
                base + '/parent.html',
                base + '/assets/sync.js',
                base + '/modules/pinyin-1/index.html',
                base + '/%s' % _quote('一年级数独/一年级数独入门教程.html'),
                base + '/%s' % _quote('一年级数独/一年级数独题库（可打印）.docx')):
        try:
            r = op.open(url, timeout=25)
            body = r.read()
            log('  %-46s status=%d bytes=%d cache=%s'
                % (url.replace(base, ''), r.status, len(body),
                   r.headers.get('Cache-Control')))
        except Exception as ex:
            log('  %-46s FAIL %s' % (url, ex))
except Exception as ex:
    log('  本地验证异常: %s' % ex)

log('\n===== 结论 =====')
log('  上传 %d 个文件，sha256 不符 %d 个' % (len(FILES), len(mismatch)))
for rel, why in mismatch:
    log('    !! %s  %s' % (rel, why))

cli.close()
open(os.path.join(ROOT, '_build', 'deploy.log'), 'w', encoding='utf-8').write('\n'.join(OUT))
print('DONE')
