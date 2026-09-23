# -*- coding: utf-8 -*-
"""扫描 videos/ 目录，生成 modules/video-1/videos.js（视频清单）。

为什么必须"预生成"而不是运行时扫描：
    纯静态页面**列不了目录** —— file:// 下没有目录 API，
    nginx 不开 autoindex 也拿不到文件列表。
    所以新增视频后跑一次本脚本即可（deploy_videos.py 会自动调用它）。

目录约定：
    videos/<学科>/<任意文件名>.mp4
    - 一级目录名 = 学科，建议与 assets/catalog.js 的 subjects 对齐（不对齐会警告）
    - 文件名 = 标题；开头的 "01-" / "1." / "1、" / "01 " 会被当成排序号剥掉

可选元数据 videos/videos.json（想手调标题/简介/封面时再加）：
    {
      "综合": {
        "示例视频-10分钟.mp4": { "title": "认识图形", "desc": "10 分钟看懂图形", "cover": "" }
      }
    }

同时做**编码体检**：iPad Safari 只稳吃 H.264(avc1) + AAC(mp4a)。
HEVC/AV1 会在报告里标出来 —— 不阻断流程，但必须让你知道，
否则孩子在 iPad 上看到的是**黑屏且不报错**。
"""
import io
import json
import os
import re
import struct
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
VIDEO_DIR = os.path.join(ROOT, 'videos')
OUT_JS = os.path.join(ROOT, 'modules', 'video-1', 'videos.js')
LOG = os.path.join(ROOT, '_build', 'video_index.log')

VIDEO_EXT = ('.mp4', '.m4v', '.webm', '.mov')

#: 学科 → (emoji, 配色)。与 assets/catalog.js 的 subjects 保持一致
SUBJECT_META = {
    '语文': ('📖', '#3b82f6'),
    '数学': ('➗', '#f59e0b'),
    '英语': ('🔤', '#10b981'),
    '思维': ('🧩', '#7c6cf5'),
    '科学': ('🔬', '#06b6d4'),
    '艺术': ('🎨', '#ec4899'),
    '综合': ('🌈', '#64748b'),
}

OUT = []


def log(*a):
    line = ' '.join(str(x) for x in a)
    OUT.append(line)
    print(line)


# ---------------------------------------------------------------- mp4 探测
def mp4_info(path):
    """返回 (秒数, 视频编码, 音频编码)。解析失败返回 (0, '?', '?')。"""
    try:
        size = os.path.getsize(path)
        with open(path, 'rb') as f:
            dur, codecs = _walk(f, 0, size)
        v = next((c for c in codecs if c in ('avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09')), '?')
        a = next((c for c in codecs if c in ('mp4a', 'ac-3', 'opus')), '?')
        return dur, v, a
    except Exception:
        return 0, '?', '?'


def _walk(f, start, end):
    dur, codecs = 0, []
    f.seek(start)
    while f.tell() + 8 <= end:
        pos = f.tell()
        hdr = f.read(8)
        if len(hdr) < 8:
            break
        size, typ = struct.unpack('>I4s', hdr)
        hsz = 8
        if size == 1:
            if f.tell() + 8 > end:
                break
            size = struct.unpack('>Q', f.read(8))[0]
            hsz = 16
        elif size == 0:
            size = end - pos
        if size < hsz or pos + size > end:
            break
        body = pos + hsz
        if typ == b'mvhd':
            f.seek(body)
            ver = f.read(1)[0]
            f.read(3)
            if ver == 0:
                f.read(8)
                ts, d = struct.unpack('>II', f.read(8))
            else:
                ts, d = struct.unpack('>IQ', f.read(16))
            if ts:
                dur = d / float(ts)
        elif typ == b'stsd':
            f.seek(body + 4)
            cnt = struct.unpack('>I', f.read(4))[0]
            for _ in range(min(cnt, 4)):
                if f.tell() + 8 > pos + size:
                    break
                esz, efmt = struct.unpack('>I4s', f.read(8))
                codecs.append(efmt.decode('latin-1'))
                if esz <= 8:
                    break
                f.seek(f.tell() - 8 + esz)
        elif typ in (b'moov', b'trak', b'mdia', b'minf', b'stbl', b'edts'):
            d2, c2 = _walk(f, body, pos + size)
            dur = dur or d2
            codecs.extend(c2)
        f.seek(pos + size)
    return dur, codecs


# ---------------------------------------------------------------- 标题与排序
NUM_PREFIX = re.compile(r'^\s*(?:第\s*)?(\d{1,3})\s*[-_.、,，)）]\s*')


def split_title(fname):
    """从文件名提取 (排序号, 标题)。'01-认识图形.mp4' → (1, '认识图形')"""
    stem = os.path.splitext(fname)[0]
    m = NUM_PREFIX.match(stem)
    if m:
        return int(m.group(1)), stem[m.end():].strip() or stem
    return 999, stem


def load_meta():
    p = os.path.join(VIDEO_DIR, 'videos.json')
    if not os.path.exists(p):
        return {}
    try:
        with io.open(p, encoding='utf-8') as f:
            return json.load(f) or {}
    except Exception as e:
        log('! videos.json 解析失败（忽略）：%r' % (e,))
        return {}


def main():
    if not os.path.isdir(VIDEO_DIR):
        log('! 还没有 videos/ 目录。建立它并在里面按学科建子目录，例如：')
        log('    videos/语文/01-拼音儿歌.mp4')
        warn = 0
        groups = []
    else:
        meta = load_meta()
        warn = 0
        groups = []
        for sub in sorted(os.listdir(VIDEO_DIR)):
            subdir = os.path.join(VIDEO_DIR, sub)
            if not os.path.isdir(subdir):
                continue
            # 按"系列"（学科下的一级子目录）分组；直接放在学科根下的算"无系列"
            buckets = {}
            for dirpath, _dirs, fnames in os.walk(subdir):
                for fn in fnames:
                    if not fn.lower().endswith(VIDEO_EXT):
                        continue
                    full = os.path.join(dirpath, fn)
                    rel_in_sub = os.path.relpath(full, subdir).replace('\\', '/')
                    parts = rel_in_sub.split('/')
                    series = parts[0] if len(parts) > 1 else ''
                    order, title = split_title(fn)
                    ov = (meta.get(sub) or {}).get(rel_in_sub) or {}
                    sec, vcodec, acodec = mp4_info(full)
                    ok = (vcodec in ('avc1', 'avc3') and acodec == 'mp4a')
                    if not ok:
                        warn += 1
                        log('  ⚠️ 编码不兼容 iPad：%s/%s  → 视频 %s / 音频 %s' % (sub, rel_in_sub, vcodec, acodec))
                    buckets.setdefault(series, []).append({
                        'id': '%s/%s' % (sub, rel_in_sub),
                        'title': ov.get('title') or title,
                        'desc': ov.get('desc') or '',
                        'cover': ov.get('cover') or '',
                        'file': '../../videos/%s/%s' % (sub, rel_in_sub),
                        'sec': int(round(sec)),
                        'size': os.path.getsize(full),
                        'vcodec': vcodec,
                        'acodec': acodec,
                        'ok': ok,
                        '_order': order,
                    })
            if not buckets:
                continue
            series_list = []
            # 有名字的系列在前，直接散放在学科根下的（空名字）排最后
            for sname in sorted(buckets, key=lambda s: (s == '', s)):
                items = buckets[sname]
                items.sort(key=lambda x: (x['_order'], x['title']))
                for it in items:
                    it.pop('_order', None)
                series_list.append({
                    'name': sname,
                    'count': len(items),
                    'seconds': sum(i['sec'] for i in items),
                    'items': items,
                })
            emoji, color = SUBJECT_META.get(sub, ('🎬', '#64748b'))
            if sub not in SUBJECT_META:
                log('  ! 学科「%s」不在 catalog.subjects 里，用默认配色（不影响使用）' % sub)
            groups.append({
                'name': sub, 'emoji': emoji, 'color': color,
                'series': series_list,
                'count': sum(s['count'] for s in series_list),
                'seconds': sum(s['seconds'] for s in series_list),
            })

        # 学科顺序按 SUBJECT_META 的定义顺序，未知学科排在后面
        order = {k: i for i, k in enumerate(SUBJECT_META)}
        groups.sort(key=lambda g: order.get(g['name'], 99))

    total = sum(g['count'] for g in groups)
    total_sec = sum(g['seconds'] for g in groups)
    total_size = sum(i['size'] for g in groups for s in g['series'] for i in s['items'])

    log('')
    log('学科 %d 个 / 视频 %d 个 / 总时长 %s / 合计 %.1f MB'
        % (len(groups), total, fmt_dur(total_sec), total_size / 1048576.0))
    for g in groups:
        log('  %s %-4s %d 个系列 / %d 个视频' % (g['emoji'], g['name'], len(g['series']), g['count']))
    if warn:
        log('')
        log('⚠️ 有 %d 个视频的编码 iPad 可能播不了（见上面）。')
        log('   要转成 H.264 + AAC，本机需要有 ffmpeg：')
        log('   ffmpeg -i 输入.mp4 -c:v libx264 -profile:v high -pix_fmt yuv420p -c:a aac -b:a 128k 输出.mp4')

    js = render_js(groups, total, total_sec)
    os.makedirs(os.path.dirname(OUT_JS), exist_ok=True)
    with io.open(OUT_JS, 'w', encoding='utf-8') as f:
        f.write(js)
    log('')
    log('已写入 %s' % os.path.relpath(OUT_JS, ROOT).replace('\\', '/'))

    with io.open(LOG, 'w', encoding='utf-8') as f:
        f.write('\n'.join(OUT))
    return 0


def fmt_dur(sec):
    sec = int(sec)
    return '%d:%02d' % (sec // 60, sec % 60) if sec < 3600 else '%d:%02d:%02d' % (sec // 3600, sec % 60 // 60, sec % 60)


def js_str(s):
    return json.dumps(s, ensure_ascii=False)


def render_js(groups, total, total_sec):
    L = []
    L.append('/* ==========================================================================')
    L.append('   视频清单 —— 自动生成，请勿手改')
    L.append('   生成脚本：python _build/build_video_index.py')
    L.append('   生成时间：%s' % time.strftime('%Y-%m-%d %H:%M:%S'))
    L.append('   --------------------------------------------------------------------------')
    L.append('   视频文件放 videos/<学科>/ 下，跑一次生成脚本就会出现在这里。')
    L.append('   用 JS 而不是 JSON，是为了让 index.html 双击直接打开(file://)时也能读到。')
    L.append('   ========================================================================== */')
    L.append('')
    L.append('window.XYB_VIDEOS = {')
    L.append('  generatedAt: %s,' % js_str(time.strftime('%Y-%m-%d %H:%M:%S')))
    L.append('  total: %d,' % total)
    L.append('  totalSeconds: %d,' % total_sec)
    L.append('  subjects: [')
    for gi, g in enumerate(groups):
        L.append('    {')
        L.append('      name: %s, emoji: %s, color: %s,' % (js_str(g['name']), js_str(g['emoji']), js_str(g['color'])))
        L.append('      count: %d, seconds: %d,' % (g['count'], g['seconds']))
        L.append('      series: [')
        for si, s in enumerate(g['series']):
            L.append('        { name: %s, count: %d, seconds: %d,' % (js_str(s['name']), s['count'], s['seconds']))
            L.append('          items: [')
            for i, it in enumerate(s['items']):
                L.append('            { id: %s, title: %s, file: %s,' % (js_str(it['id']), js_str(it['title']), js_str(it['file'])))
                L.append('              sec: %d, size: %d, ok: %s, vcodec: %s, acodec: %s,%s }%s'
                         % (it['sec'], it['size'], 'true' if it['ok'] else 'false',
                            js_str(it['vcodec']), js_str(it['acodec']),
                            (' desc: %s,' % js_str(it['desc'])) if it['desc'] else '',
                            ',' if i < len(s['items']) - 1 else ''))
            L.append('          ]')
            L.append('        }%s' % (',' if si < len(g['series']) - 1 else ''))
        L.append('      ]')
        L.append('    }%s' % (',' if gi < len(groups) - 1 else ''))
    L.append('  ]')
    L.append('};')
    L.append('')
    return '\n'.join(L)


if __name__ == '__main__':
    sys.exit(main())
