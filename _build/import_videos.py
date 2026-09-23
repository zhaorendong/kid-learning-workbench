# -*- coding: utf-8 -*-
"""把一个"课程包"目录重组成工作台认识的学科结构。

为什么要重组：
    下载工具给的目录是 `斑马主题课/<系列名>/<集目录>/<集>.mp4`，
    而视频库的约定是 `videos/<学科>/<系列>/NN-集.mp4`。
    不重组的话，33 个系列会全挤在一个分类下（334 个视频平铺，没法用）。

    videos/斑马主题课/0基础魔方训练免费领/01-误入魔方世界/01-误入魔方世界.mp4
        ↓
    videos/思维/0基础魔方训练免费领/01-误入魔方世界.mp4

顺带把"每个视频套一个同名目录"这种多余的一层压平。

用法：
    python _build/import_videos.py --dry-run        # 先看会怎么分（推荐先跑这个）
    python _build/import_videos.py                  # 真的重排（同盘移动，很快）
    python _build/import_videos.py --src "别的课程包目录"
    python _build/import_videos.py --copy           # 复制而不是移动（占双份空间）
"""
import argparse
import io
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_video_index as bvi      # noqa: E402

ROOT = bvi.ROOT
VIDEO_DIR = bvi.VIDEO_DIR
LOG = os.path.join(HERE, 'import_videos.log')
OUT = []

#: 系列名 → 学科。**顺序有意义**：从上往下第一个命中的规则生效。
#: 想让某个系列换个学科，把关键词挪到前面的规则里就行。
SUBJECT_RULES = [
    (r'英语|全英|纯英|单词|口语', '英语'),
    (r'拼音|汉字|写字|文房四宝|文学|古诗|童话|故事|阅读', '语文'),
    (r'加减法|分类与统计|单双数|口算|数学|几何|图形', '数学'),
    (r'魔方|围棋|思维|逻辑|推理', '思维'),
    (r'名画|音乐|手绘|绘画|十二生肖|五线谱|美术|唱跳', '艺术'),
    (r'科学|航天|恐龙|实验|自然', '科学'),
    (r'情绪|幼升小|习惯|家庭|启蒙必备', '综合'),
]

#: 判断不出来时归到这里
FALLBACK = '综合'


def log(*a):
    line = ' '.join(str(x) for x in a)
    OUT.append(line)
    print(line, flush=True)


def pick_subject(series_name):
    for pat, subj in SUBJECT_RULES:
        if re.search(pat, series_name):
            return subj
    return FALLBACK


def flatten(rel):
    """把 `01-xxx/01-xxx.mp4` 压成 `01-xxx.mp4`（目录名与文件名同名时）。"""
    parts = rel.replace('\\', '/').split('/')
    if len(parts) >= 2:
        stem = os.path.splitext(parts[-1])[0]
        # 同名目录可能连续套多层，逐层压平
        while len(parts) >= 2 and parts[-2] == stem:
            parts = parts[:-2] + [parts[-1]]
    return '/'.join(parts)


def clean_empty(src):
    """删掉搬空后留下的空目录。

    注意：os.walk 遍历期间删目录，会让后续的 os.listdir 抛 FileNotFoundError ——
    每一步都要 try 住。第一次跑的时候真踩了：334 个文件全搬完，脚本崩在清理上。
    """
    removed = 0
    for _ in range(5):                        # 可能有多层嵌套，多扫几遍
        try:
            for dp, _dirs, _files in os.walk(src, topdown=False):
                if dp == src:
                    continue
                try:
                    if not os.listdir(dp):
                        os.rmdir(dp)
                        removed += 1
                except OSError:
                    pass
        except OSError:
            pass
    try:
        if os.path.isdir(src) and not os.listdir(src):
            os.rmdir(src)
            log('  已删除搬空的课程包目录：%s' % os.path.basename(src))
            return
    except OSError as e:
        log('  课程包目录没删干净（%s），手工删掉也行' % e)
        return
    log('  清掉 %d 个空目录（原目录里还有东西，保留着）' % removed)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=None, help='课程包目录（默认 videos/斑马主题课）')
    ap.add_argument('--dry-run', action='store_true', help='只显示计划，不动文件')
    ap.add_argument('--copy', action='store_true', help='复制而不是移动（占双份空间）')
    args = ap.parse_args()

    src = args.src or os.path.join(VIDEO_DIR, '斑马主题课')
    if not os.path.isdir(src):
        log('! 找不到课程包目录：%s' % src)
        log('  （用 --src 指定别的目录）')
        return 1

    series_list = sorted([d for d in os.listdir(src) if os.path.isdir(os.path.join(src, d))])
    log('课程包：%s' % src)
    log('系列数：%d' % len(series_list))
    log('')

    plan = []          # (src_file, dst_file, subject, series)
    for series in series_list:
        sdir = os.path.join(src, series)
        subj = pick_subject(series)
        files = []
        for dp, _dirs, fnames in os.walk(sdir):
            for fn in fnames:
                if fn.lower().endswith(bvi.VIDEO_EXT):
                    files.append(os.path.join(dp, fn))
        if not files:
            continue
        for f in sorted(files):
            rel = os.path.relpath(f, sdir)
            rel = flatten(rel)
            dst = os.path.join(VIDEO_DIR, subj, series, rel.replace('/', os.sep))
            if os.path.normpath(dst) == os.path.normpath(f):
                continue                      # 已经在正确位置
            plan.append((f, dst, subj, series))

    # 按学科汇总展示
    by_subj = {}
    for f, dst, subj, series in plan:
        by_subj.setdefault(subj, {}).setdefault(series, 0)
        by_subj[subj][series] += 1
    for subj in bvi.SUBJECT_META:
        if subj not in by_subj:
            continue
        n = sum(by_subj[subj].values())
        log('%s %s（%d 个系列 / %d 个视频）' % (bvi.SUBJECT_META[subj][0], subj, len(by_subj[subj]), n))
        for series, c in sorted(by_subj[subj].items()):
            log('    %-34s %3d 个' % (series, c))
    log('')
    log('合计要搬 %d 个视频' % len(plan))

    if args.dry_run:
        log('')
        log('（--dry-run：没有动任何文件）')
        log('  觉得分得不对？改 import_videos.py 顶部的 SUBJECT_RULES 再跑。')
        write_log()
        return 0

    if not plan:
        log('')
        log('没有需要搬动的文件（可能已经重组过了）。')
        if not args.copy:
            clean_empty(src)                  # 顺手把上次没清干净的空调删掉
        write_log()
        return 0

    log('')
    log('开始%s…' % ('复制' if args.copy else '移动'))
    ok, fail = 0, []
    moved_dirs = []
    for i, (f, dst, subj, series) in enumerate(plan, 1):
        try:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if args.copy:
                if not os.path.exists(dst):
                    shutil.copy2(f, dst)
            else:
                shutil.move(f, dst)          # 同盘移动：NTFS 上只改元数据，很快
            ok += 1
            moved_dirs.append(os.path.dirname(f))
        except Exception as e:
            fail.append((f, repr(e)))
        if i % 50 == 0:
            log('  … %d/%d' % (i, len(plan)))

    log('  完成 %d 个，失败 %d 个' % (ok, len(fail)))
    for f, why in fail[:10]:
        log('    ✗ %s  %s' % (f, why))

    # 清理搬空后留下的空目录
    if not args.copy:
        clean_empty(src)

    log('')
    log('下一步：')
    log('  python _build/add_video.py --list        # 看看现在各学科多少个')
    log('  python _build/build_video_index.py       # 生成清单')
    write_log()
    return 0


def write_log():
    with io.open(LOG, 'w', encoding='utf-8') as f:
        f.write('\n'.join(OUT))


if __name__ == '__main__':
    sys.exit(main())
