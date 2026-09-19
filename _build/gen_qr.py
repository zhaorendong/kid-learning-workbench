# -*- coding: utf-8 -*-
"""生成访问二维码：局域网（iPad）+ VPN（远程）+ 家长端。

地址来自 `_build/site_config.py`（真实值放 site.local.json，不进仓库）。
生成的三个 png 已在 .gitignore 里 —— 它们承载家里的真实网络地址。
"""
import os

import qrcode
from qrcode.constants import ERROR_CORRECT_M

import site_config
from site_config import CFG

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PORT = int(CFG['web_port'])
LAN = CFG['host_lan']
VPN = CFG['host']

TARGETS = [
    ('qr-ipad-lan.png', 'http://%s:%d/?v=1' % (LAN, PORT),
     '家里的 iPad / 手机（局域网）'),
    ('qr-remote-wg.png', 'http://%s:%d/' % (VPN, PORT),
     '户外走 VPN（设备需已接入）'),
    # 家长端单独一张：孩子端的入口链接藏在页面最底部，家长在 iPad 上常找不到，
    # 直接扫这张就进家长中心（仍然要输入家长密码）。
    ('qr-parent-lan.png', 'http://%s:%d/parent.html?v=1' % (LAN, PORT),
     '家长中心（局域网）—— 扫进去输家长密码，别给孩子'),
]

OUT = []
for fname, url, desc in TARGETS:
    qr = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_M,
                       box_size=12, border=3)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color='#1f2937', back_color='white').convert('RGB')
    path = os.path.join(ROOT, fname)
    img.save(path)

    # 解回来验证：用同一个库把像素数据再解一次（粗验：尺寸、非空白）
    px = img.load()
    w, h = img.size
    dark = sum(1 for y in range(0, h, 3) for x in range(0, w, 3)
               if px[x, y][0] < 128)
    OUT.append('%s\n  url  = %s\n  说明 = %s\n  尺寸 = %dx%d\n  暗点采样 = %d\n'
               % (fname, url, desc, w, h, dark))

open(os.path.join(ROOT, '_build', 'qr.log'), 'w', encoding='utf-8').write('\n'.join(OUT))
print('done')
