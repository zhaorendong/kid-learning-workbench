# -*- coding: utf-8 -*-
"""把视频加进视频库：自动归类到学科、规范命名、体检编码，可选直接上传。

为什么要这个脚本：
    视频库的约定是 `videos/<学科>/NN-标题.mp4`，但拿到的视频往往叫
    `9736be99-1740-43dd-8998-67847f8c4438.mp4` 这种。手动建目录、改名、排序、
    再跑两条命令，容易漏步骤（尤其"忘了跑清单"会导致页面上看不到）。
    这里一次做完，并且顺手体检编码。

用法：
    # 加一个（自动排到该学科末尾）
    python _build/add_video.py "D:\\下载\\认识图形.mp4" --subject 数学

    # 指定标题与排序
    python _build/add_video.py "D:\\下载\\a.mp4" --subject 语文 --title "拼音儿歌" --order 1

    # 批量：把整个目录里的视频都加进某学科
    python _build/add_video.py --dir "D:\\下载\\学习视频" --subject 科学

    # 加完直接传上服务器（需要装了 paramiko 的 Python，见 docs/运维手册.md）
    python _build/add_video.py "D:\\下载\\a.mp4" --subject 数学 --upload

    # 只看会做什么，不动任何文件
    python _build/add_video.py "D:\\下载\\a.mp4" --subject 数学 --dry-run

    # 看看现在有哪些学科、各几个
    python _build/add_video.py --list

加完之后：
    - 不加 --upload：清单已重新生成，本地/局域网刷新就能看到；**要上服务器还得跑 deploy_videos.py**
    - 加了 --upload：清单 + 上传一次做完，iPad 刷新即可
"""
import argparse
import io
import os
import re
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import build_video_index as bvi      # noqa: E402  （复用学科定义与 MP4 解析）

ROOT = bvi.ROOT
VIDEO_DIR = bvi.VIDEO_DIR
LOG = os.path.join(HERE, 'add_video.log')
OUT = []


def log(*a):
    line = ' '.join(str(x) for x in a)
    OUT.append(line)
    print(line, flush=True)      # flush：否则和子进程（清单/上传脚本）的输出会交错


def safe_name(s):
    """文件名规范化：去掉非法字符，空格换成 -（URL 里更省事）。"""
    s = re.sub(r'[\\/:*?"<>|]', '', str(s or '')).strip()
    s = re.sub(r'\s+', '-', s)
    return s.strip('.-_') or 'video'


def next_order(subdir):
    """该学科下一个可用的排序号。"""
    n = 0
    if os.path.isdir(subdir):
        for f in os.listdir(subdir):
            m = re.match(r'^(\d{1,3})[-_.\s]', f)
            if m:
                n = max(n, int(m.group(1)))
    return n + 1


def check_codec(path):
    """返回 (秒, 视频编码, 音频编码, 是否 iPad 可直接播)。"""
    sec, v, a = bvi.mp4_info(path)
    return sec, v, a, (v in ('avc1', 'avc3') and a == 'mp4a')


def add_one(src, subject, title, desc, order, move, dry):
    """返回 (是否成功, 目标相对路径)。"""
    if not os.path.isfile(src):
        log('  ✗ 找不到文件：%s' % src)
        return False, None

    ext = os.path.splitext(src)[1].lower()
    if ext not in bvi.VIDEO_EXT:
        log('  ✗ 不支持的格式 %s（支持 %s）' % (ext, '、'.join(bvi.VIDEO_EXT)))
        return False, None

    subdir = os.path.join(VIDEO_DIR, subject)
    stem = title or os.path.splitext(os.path.basename(src))[0]
    stem = safe_name(stem)
    num = order if order else next_order(subdir)
    dst = os.path.join(subdir, '%02d-%s%s' % (num, stem, ext))

    # 重名保护：自动往下顺延，绝不覆盖已有文件
    while os.path.exists(dst):
        if os.path.samefile(src, dst) if os.path.exists(src) else False:
            break
        num += 1
        dst = os.path.join(subdir, '%02d-%s%s' % (num, stem, ext))

    sec, v, a, ok = check_codec(src)
    dur = bvi.fmt_dur(sec) if sec else '?'
    rel = os.path.relpath(dst, VIDEO_DIR).replace('\\', '/')

    log('  → %s' % rel)
    log('     时长 %s · 视频 %s · 音频 %s · %.1f MB' % (dur, v, a, os.path.getsize(src) / 1048576.0))
    if not ok:
        log('     ⚠️ 这个编码 iPad 可能播不了（只稳吃 H.264 + AAC）——'
            ' 先转码再用：ffmpeg -i 输入.mp4 -c:v libx264 -pix_fmt yuv420p -c:a aac 输出.mp4')

    if dry:
        log('     （--dry-run：没有真的复制）')
        return True, rel

    os.makedirs(subdir, exist_ok=True)
    if move:
        shutil.move(src, dst)
    else:
        shutil.copy2(src, dst)
    log('     %s完成' % ('移动' if move else '复制'))

    if desc:
        write_meta(subject, os.path.basename(dst), {'title': stem, 'desc': desc})
    return True, rel


def write_meta(subject, filename, info):
    """把标题/简介写进 videos/videos.json（可选的手工元数据文件）。"""
    import json
    p = os.path.join(VIDEO_DIR, 'videos.json')
    data = {}
    if os.path.exists(p):
        try:
            with io.open(p, encoding='utf-8') as f:
                data = json.load(f) or {}
        except Exception:
            data = {}
    data.setdefault(subject, {})[filename] = info
    with io.open(p, 'w', encoding='utf-8') as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2))
    log('     已写入标题/简介到 videos/videos.json')


def do_list():
    log('视频库：%s' % VIDEO_DIR)
    if not os.path.isdir(VIDEO_DIR):
        log('  （还没有 videos/ 目录，第一次用这个脚本会自动建）')
        return
    total = 0
    for sub in sorted(os.listdir(VIDEO_DIR)):
        d = os.path.join(VIDEO_DIR, sub)
        if not os.path.isdir(d):
            continue
        files = [f for f in os.listdir(d) if f.lower().endswith(bvi.VIDEO_EXT)]
        total += len(files)
        mark = '' if sub in bvi.SUBJECT_META else '  （自定义学科，页面用默认配色）'
        log('  %-8s %d 个%s' % (sub, len(files), mark))
        for f in sorted(files):
            log('      %s' % f)
    log('  合计 %d 个视频' % total)
    log('')
    log('标准学科：%s' % '、'.join(bvi.SUBJECT_META.keys()))


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument('source', nargs='?', help='要加入的视频文件（与 --dir 二选一）')
    ap.add_argument('--dir', help='批量：把这个目录里的所有视频都加进来')
    ap.add_argument('--subject', help='归到哪个学科（语文/数学/英语/思维/科学/艺术/综合，也可以自定）')
    ap.add_argument('--title', help='标题（只对单个文件有效；不给就用原文件名）')
    ap.add_argument('--desc', help='一句话简介（会写进 videos/videos.json）')
    ap.add_argument('--order', type=int, help='排序号（默认排到该学科最后）')
    ap.add_argument('--move', action='store_true', help='移动而不是复制（默认复制，安全）')
    ap.add_argument('--upload', action='store_true', help='加完直接上传到服务器')
    ap.add_argument('--dry-run', action='store_true', help='只显示计划，不动文件')
    ap.add_argument('--list', action='store_true', help='列出视频库现状')
    args = ap.parse_args()

    if args.list:
        do_list()
        return 0

    if not args.subject:
        log('! 要指定 --subject（归到哪个学科）。标准学科：')
        log('  ' + '、'.join(bvi.SUBJECT_META.keys()))
        log('  （也可以用别的名字，只是页面会用默认配色）')
        return 1
    if not args.source and not args.dir:
        log('! 要给一个视频文件，或者用 --dir 指定一个目录。--help 看用法。')
        return 1
    if args.source and args.dir:
        log('! source 和 --dir 只能给一个。')
        return 1

    if args.subject not in bvi.SUBJECT_META:
        log('提示：学科「%s」不在标准列表里，页面会用默认配色（不影响使用）' % args.subject)
    log('学科：%s' % args.subject)

    sources = []
    if args.dir:
        if not os.path.isdir(args.dir):
            log('! 目录不存在：%s' % args.dir)
            return 1
        for name in sorted(os.listdir(args.dir)):
            p = os.path.join(args.dir, name)
            if os.path.isfile(p) and name.lower().endswith(bvi.VIDEO_EXT):
                sources.append(p)
        if not sources:
            log('! 这个目录里没有视频（支持 %s）' % '、'.join(bvi.VIDEO_EXT))
            return 1
        log('批量：找到 %d 个视频' % len(sources))
    else:
        sources.append(args.source)

    log('')
    okn, done = 0, []
    order = args.order
    for i, src in enumerate(sources):
        title = args.title if (args.title and not args.dir and len(sources) == 1) else None
        r, rel = add_one(src, args.subject, title, args.desc, order, args.move, args.dry_run)
        if r:
            okn += 1
            done.append(rel)
        if order:
            order += 1        # 批量指定起始序号时，后面的顺延

    if not okn:
        log('')
        log('没有加进任何视频。')
        return 1

    if args.dry_run:
        log('')
        log('（--dry-run：文件没动，清单也没重新生成）')
        write_log()
        return 0

    log('')
    if args.upload:
        log('=== 生成清单并上传 ===')
        try:
            import paramiko        # noqa: F401
        except ImportError:
            log('! --upload 需要 paramiko。请换用装了它的 Python 跑，例如：')
            log('  ...\\python\\envs\\default\\Scripts\\python.exe _build\\add_video.py ...')
            log('  （现在文件已经放好了，单独跑 _build/deploy_videos.py 也可以）')
            write_log()
            return 1
        r = subprocess.run([sys.executable, os.path.join(HERE, 'deploy_videos.py')], cwd=ROOT)
        if r.returncode != 0:
            log('! 上传没成功（exit=%d），看上面输出或 _build/deploy_videos.log' % r.returncode)
            write_log()
            return r.returncode
    else:
        log('=== 重新生成清单 ===')
        r = subprocess.run([sys.executable, os.path.join(HERE, 'build_video_index.py')], cwd=ROOT)
        if r.returncode != 0:
            log('! 清单生成失败')
            write_log()
            return r.returncode
        log('')
        log('下一步（要让孩子在 iPad 上看到，必须上传）：')
        log('  python _build/deploy_videos.py')
        log('  （或者下次加视频时直接加 --upload 参数）')

    log('')
    log('===== 结论 =====')
    log('  成功加入 %d 个视频：%s' % (okn, '、'.join(x for x in done if x)))
    write_log()
    return 0


def write_log():
    with io.open(LOG, 'w', encoding='utf-8') as f:
        f.write('\n'.join(OUT))


if __name__ == '__main__':
    sys.exit(main())
