# -*- coding: utf-8 -*-
"""
把生成的配音以 base64 内嵌进教程 HTML（保持"单文件、双击即用"）。

用法: python inject_audio.py <教程.html>
幂等：靠 AUDIO_DATA_START / END 标记定位，重复执行只替换，不会叠加。
"""
import base64
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MAP_PATH = os.path.join(HERE, 'audio_map.json')
AUDIO_DIR = os.path.join(HERE, 'audio')

START = '<!--AUDIO_DATA_START-->'
END = '<!--AUDIO_DATA_END-->'


def build_block():
    items = json.load(open(MAP_PATH, encoding='utf-8'))
    lines = []
    total = 0
    for it in items:
        fn = it.get('file')
        if not fn:
            continue
        raw = open(os.path.join(AUDIO_DIR, fn), 'rb').read()
        total += len(raw)
        b64 = base64.b64encode(raw).decode('ascii')
        key = json.dumps(it['text'], ensure_ascii=False)
        lines.append('%s:["%s",%d]' % (key, b64, it['dur_ms']))

    body = ',\n'.join(lines)
    block = (
        START + '\n'
        '<script>\n'
        '/* 配音数据：晓伊童声（edge-tts zh-CN-XiaoyiNeural，语速 -8%，32kbps 单声道）\n'
        '   格式：{ "台词": [base64 mp3, 时长毫秒] }\n'
        '   缺句会自动回退到浏览器自带中文语音，不会哑掉。 */\n'
        'window.__AUDIO__={\n' + body + '\n};\n'
        '</script>\n'
        + END
    )
    return block, len(items), total


def main():
    if len(sys.argv) < 2:
        print('用法: python inject_audio.py <教程.html>')
        sys.exit(2)
    path = sys.argv[1]
    html = open(path, encoding='utf-8').read()

    block, n, raw_bytes = build_block()
    print('配音 %d 条，mp3 共 %.0f KB，base64 后约 %.0f KB'
          % (n, raw_bytes / 1024, raw_bytes * 4 / 3 / 1024))

    # 幂等：先清掉旧块
    html = re.sub(re.escape(START) + r'.*?' + re.escape(END) + r'\n?', '', html, flags=re.S)

    if '</body>' not in html:
        print('找不到 </body>，无法注入')
        sys.exit(1)
    html = html.replace('</body>', block + '\n</body>', 1)

    open(path, 'w', encoding='utf-8').write(html)
    size = os.path.getsize(path)
    print('已写入: %s' % path)
    print('文件体积: %.0f KB (%.2f MB)' % (size / 1024, size / 1024 / 1024))

    # 自检：标记唯一、可解析
    assert html.count(START) == 1 and html.count(END) == 1, '标记重复'
    m = re.search(r'window\.__AUDIO__=(\{.*?\n\});', html, re.S)
    assert m, '找不到 AUDIO 数据块'
    obj = json.loads(m.group(1))
    assert len(obj) == n, '条目数不符 %d != %d' % (len(obj), n)
    assert all(len(v) == 2 and v[0] and isinstance(v[1], int) for v in obj.values()), '结构异常'
    print('自检通过：%d 条，标记唯一，JSON 可解析' % len(obj))


if __name__ == '__main__':
    main()
