# -*- coding: utf-8 -*-
"""把生成的二维码真的解回来，确认里面写的 URL 正确（不靠"应该是对的"）。

期望值由 gen_qr.py 的同一份配置推导，两边不会走偏。
"""
import io
import os

import cv2
import numpy as np

import site_config
from site_config import CFG

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PORT = int(CFG['web_port'])
LAN = CFG['host_lan']
VPN = CFG['host']

EXPECT = {
    'qr-ipad-lan.png': 'http://%s:%d/?v=1' % (LAN, PORT),
    'qr-remote-wg.png': 'http://%s:%d/' % (VPN, PORT),
    'qr-parent-lan.png': 'http://%s:%d/parent.html?v=1' % (LAN, PORT),
}

OUT = []
det = cv2.QRCodeDetector()
bad = 0
for fname, want in EXPECT.items():
    p = os.path.join(ROOT, fname)
    if not os.path.exists(p):
        bad += 1
        OUT.append('SKIP  %s（文件不存在，先跑 gen_qr.py）' % fname)
        continue
    # 注意：项目路径含中文，cv2.imread 在 Windows 上会直接返回 None
    #      —— 必须用 fromfile + imdecode 这条绕开路径编码的路。
    img = cv2.imdecode(np.fromfile(p, dtype=np.uint8), cv2.IMREAD_COLOR)
    data, _, _ = det.detectAndDecode(img)
    ok = (data == want)
    if not ok:
        bad += 1
    OUT.append('%s  %s\n    解出 = %r\n    期望 = %r'
               % ('OK  ' if ok else 'FAIL', fname, data, want))

OUT.append('\n%d/%d 张二维码内容正确' % (len(EXPECT) - bad, len(EXPECT)))
with io.open(os.path.join(ROOT, '_build', 'qr_verify.log'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(OUT))
print('\n'.join(OUT))
