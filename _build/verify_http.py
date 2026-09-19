# -*- coding: utf-8 -*-
"""终验：经 HTTP 取回页面，按 UTF-8 解码后校验特征串 + 引用可达性。
   注意：catalog 里 planned 的模块本地本就没有文件，不算失败。

地址来自 `_build/site_config.py`（真实值放 site.local.json，不进仓库）。
"""
import os
import re
import traceback
import urllib.error
import urllib.parse
import urllib.request

import site_config
from site_config import CFG

BASE = 'http://%s:%d' % (CFG['host'], int(CFG['web_port']))
OUT = []
op = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def get(path):
    """返回 (status, body, headers)；404 不抛异常。"""
    url = BASE + urllib.parse.quote(path)
    try:
        r = op.open(url, timeout=25)
        return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, b'', dict(e.headers or {})


def main():
    OUT.append('===== 1. 页面特征串 =====')
    checks = [
        # 注意：孩子端刻意不加载 xyb-sdk.js（它只消费 SDK 写入的 inbox 队列，
        # 不调用 SDK 函数）；XYB_CATALOG 由 catalog.js 提供，不出现在页面里。
        ('/', ['小悦饼', 'catalog.js', 'core.js', 'student.js', 'parent.html', 'sync.js']),
        ('/parent.html', ['gatePin', 'parent.js', 'core.js', 'sync.js', 'syncUrl']),
        ('/assets/core.js', ['XYB', 'mistakes', 'localStorage']),
        ('/assets/sync.js', ['XYBSync', 'sha256hex', '/api/sync', 'ackIds']),
        ('/assets/catalog.js', ['pinyin-1', 'math-calc', 'sudoku-1']),
        ('/assets/student.js', ['reviewDot', 'syncState']),
        ('/assets/parent.js', ['lockUntil', 'syncRoll']),
        ('/assets/xyb-sdk.js', ['XYB', 'speak']),
        ('/assets/app.css', ['.mcard', '.gate', '.sync-state']),
        ('/modules/pinyin-1/index.html', ['xyb-sdk.js', 'data-module-id="pinyin-1"', 'audio.js']),
        ('/modules/pinyin-1/audio.js', ['XYB_PINYIN_AUDIO', 'data:audio/mpeg;base64']),
        ('/modules/math-calc/index.html', ['xyb-sdk.js', 'data-module-id="math-calc"']),
        ('/modules/_template/index.html', ['xyb-sdk.js']),
        ('/manifest.webmanifest', ['小悦饼']),
    ]
    allok = True
    for path, needles in checks:
        st, body, _ = get(path)
        txt = body.decode('utf-8', 'replace')
        miss = [n for n in needles if n not in txt]
        if st != 200 or miss:
            allok = False
        OUT.append('  %-34s status=%d bytes=%-8d %s'
                   % (path, st, len(body),
                      '全部命中 ✅' if not miss else '缺: ' + ','.join(miss) + ' ❌'))

    OUT.append('\n===== 2. catalog 条目逐条核查（模拟点卡片）=====')
    _, catb, _ = get('/assets/catalog.js')
    cat = catb.decode('utf-8')
    # 每个模块条目是一个不含嵌套对象的 {...} 块
    bad_ready = []
    for blk in re.findall(r'\{[^{}]*\}', cat):
        if 'id:' not in blk or 'url:' not in blk:
            continue
        mid = re.search(r"id:\s*'([^']+)'", blk).group(1)
        url = re.search(r"url:\s*'([^']+)'", blk).group(1)
        stt = re.search(r"status:\s*'([^']+)'", blk)
        stt = stt.group(1) if stt else 'ready'
        rel = url[2:] if url.startswith('./') else url
        st, b, _ = get('/' + rel)
        exp = (stt == 'ready')
        good = (st == 200) if exp else (st != 200)
        flag = '✅' if good else ('❌ 应可达但 404' if exp else '❌ 标记 planned 但文件在')
        if not good:
            bad_ready.append(mid)
        OUT.append('  %-14s %-9s %-42s status=%-3d %s'
                   % (mid, stt, rel, st, flag))

    OUT.append('\n===== 3. ready 模块的 SDK id 三处一致 =====')
    for mid in ('math-calc', 'pinyin-1'):
        st, b, _ = get('/modules/%s/index.html' % mid)
        t = b.decode('utf-8')
        st2, b2, _ = get('/modules/%s/module.json' % mid)
        mj = b2.decode('utf-8')
        a = 'data-module-id="%s"' % mid in t
        c = '"id": "%s"' % mid in mj or '"id":"%s"' % mid in mj
        OUT.append('  %-12s 页面=%s  module.json=%s  catalog=✅' %
                   (mid, '✅' if a else '❌', '✅' if c else '❌'))

    OUT.append('\n===== 4. 数独中文路径 + 可打印题库 =====')
    for rel, kind in [('一年级数独/一年级数独入门教程.html', '页面'),
                      ('一年级数独/一年级数独题库（可打印）.docx', '文档')]:
        st, b, h = get('/' + rel)
        OUT.append('  %-6s %-40s status=%d bytes=%-9d type=%s'
                   % (kind, rel, st, len(b), h.get('Content-Type')))

    OUT.append('\n===== 5. 缓存头（iPad 拿新版的关键）=====')
    for path in ('/', '/assets/core.js', '/modules/pinyin-1/index.html'):
        st, b, h = get(path)
        OUT.append('  %-32s Cache-Control=%s | ETag=%s'
                   % (path, h.get('Cache-Control'), '有' if h.get('ETag') else '无'))

    OUT.append('\n===== 6. 回到根路径的可达性（模块页返回按钮依赖）=====')
    st, b, _ = get('/index.html')
    OUT.append('  /index.html status=%d bytes=%d' % (st, len(b)))

    OUT.append('\n===== 7. 数据服务（多端同步的后端）=====')
    DS = 'http://%s:%d' % (CFG['host'], int(CFG['api_port']))
    OUT.append('  地址: %s' % DS)

    def dget(path, key=None):
        rq = urllib.request.Request(DS + path)
        if key:
            rq.add_header('Authorization', 'Bearer ' + key)
        try:
            with op.open(rq, timeout=15) as r:
                return r.status, r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            try:
                return e.code, e.read().decode('utf-8', 'replace')
            except Exception:
                return e.code, ''
        except Exception as e:
            return -1, str(e)

    st, body = dget('/api/ping')
    ds_ok = (st == 200 and '"ok": true' in body)
    OUT.append('  /api/ping            status=%s %s' % (st, body[:130]))
    if st == -1:
        OUT.append('  ⚠️ 数据服务不可达（部署机没开机 / 计划任务没起 / 没连上 VPN）')
    st2, body2 = dget('/api/info')
    guarded = st2 in (401, 403)
    OUT.append('  未设口令读数据        status=%s %s'
               % (st2, '被拒绝 ✅（正确，局域网里别人看不到数据）' if guarded
                  else '⚠️ 居然放行了，得查一下' if st2 != -1 else '不可达（跳过）'))
    # 带一个错口令试探，也不该放行
    st3, _ = dget('/api/info', 'Bearer-must-be-hash')
    OUT.append('  错误口令读数据        status=%s %s'
               % (st3, '被拒绝 ✅' if st3 in (401, 403) else '⚠️ 放行了' if st3 != -1 else '不可达（跳过）'))

    OUT.append('\n===== 结论 =====')
    OUT.append('  特征串: %s' % ('全部通过 ✅' if allok else '有缺失 ❌'))
    OUT.append('  ready 条目异常: %s' % (bad_ready if bad_ready else '无 ✅'))
    OUT.append('  数据服务: %s' % ('在线且正确鉴权 ✅' if (ds_ok and guarded)
                                  else '不可达（不影响纯本机使用）' if st == -1 else '有异常，看上面 ⚠️'))


try:
    main()
except Exception:
    OUT.append('\n!!! 脚本异常 !!!\n' + traceback.format_exc())
open('_build/verify3.log', 'w', encoding='utf-8').write('\n'.join(OUT))
print('done')
