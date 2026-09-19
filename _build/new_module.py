#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
小悦饼学习工作台 · 模块脚手架 / 注册表维护工具

用法示例
--------
1) 新建一个模块（自动建目录 + 复制模板 + 写入 catalog.js）
   python _build/new_module.py --id math-calc --title "口算闪电侠" \\
          --subject 数学 --type game --emoji "⚡" --color "#f59e0b" \\
          --minutes 10 --path "数感与计算" --desc "限时口算闯关，答错自动进错题本。"

2) 已有模块目录（含 module.json）注册进工作台 / 更新元信息
   python _build/new_module.py --register modules/math-calc

3) 体检：列出所有条目并检查 url 文件是否存在
   python _build/new_module.py --check
   python _build/new_module.py --list
"""
import argparse
import io
import json
import os
import re
import shutil
import sys

try:                                    # Windows 控制台中文保护
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, 'assets', 'catalog.js')
TEMPLATE_DIR = os.path.join(ROOT, 'modules', '_template')
MODULES_DIR = os.path.join(ROOT, 'modules')

FIELDS = ['id', 'title', 'subtitle', 'subject', 'grade', 'type', 'tags', 'url',
          'emoji', 'color', 'minutes', 'desc', 'mode', 'progress', 'featured',
          'path', 'pathOrder', 'status']


# --------------------------------------------------------------------------
# catalog.js 读写
# --------------------------------------------------------------------------
def read_catalog():
    with io.open(CATALOG, 'r', encoding='utf-8') as f:
        return f.read()


def write_catalog(text):
    with io.open(CATALOG, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


def scan_entries(text):
    """提取现有模块条目：以 4 空格缩进的 {...} 块为单位（可含嵌套的 extra 数组）"""
    out = []
    for m in re.finditer(r'(?m)^    \{\n(.*?)\n    \}(?:,)?\n', text, re.S):
        block = m.group(1)
        if 'id:' not in block or 'url:' not in block:
            continue
        gid = re.search(r"id:\s*'([^']+)'", block)
        gurl = re.search(r"url:\s*'([^']+)'", block)
        gst = re.search(r"status:\s*'([^']+)'", block)
        out.append({
            'id': gid.group(1) if gid else '',
            'url': gurl.group(1) if gurl else '',
            'status': gst.group(1) if gst else 'ready',
            'span': (m.start(), m.end()),
        })
    return out


def js_val(v):
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return '[' + ', '.join("'%s'" % str(x).replace("'", "\\'") for x in v) + ']'
    s = str(v).replace("'", "\\'")
    return "'%s'" % s


def build_entry(m):
    lines = ['    {']
    order = ['id', 'title', 'subtitle', 'subject', 'grade', 'type', 'tags', 'url',
             'emoji', 'color', 'minutes', 'desc', 'mode', 'progress', 'featured',
             'path', 'pathOrder', 'status']
    for k in order:
        if k not in m:
            continue
        lines.append('      %s: %s,' % (k, js_val(m[k])))
    lines.append('    },')
    return '\n'.join(lines)


def insert_entry(text, entry):
    marker = 'modules: ['
    i = text.index(marker) + len(marker)
    return text[:i] + '\n' + entry + text[i:]


def replace_register_marker(text):
    return text


# --------------------------------------------------------------------------
# 子命令
# --------------------------------------------------------------------------
SUBJECT_COLORS = {
    '语文': '#3b82f6', '数学': '#f59e0b', '英语': '#10b981', '思维': '#7c6cf5',
    '科学': '#06b6d4', '艺术': '#ec4899', '综合': '#64748b',
}


def cmd_new(args):
    mid = args.id
    dest = os.path.join(MODULES_DIR, mid)
    if os.path.exists(dest):
        print('× 目录已存在：%s' % dest)
        return 1

    meta = {
        'id': mid,
        'title': args.title or mid,
        'subtitle': args.subtitle or '',
        'subject': args.subject or '综合',
        'grade': args.grade or '一年级',
        'type': args.type or 'lesson',
        'tags': [t for t in (args.tags or '').split(',') if t],
        'url': './modules/%s/index.html' % mid,
        'emoji': args.emoji or '📘',
        'color': args.color or SUBJECT_COLORS.get(args.subject or '综合', '#4f8ef7'),
        'minutes': args.minutes or 15,
        'desc': args.desc or '',
        'mode': 'jump',
        'progress': 'sdk',
        'featured': False,
        'path': args.path or (args.subject or '综合'),
        'pathOrder': args.order or 99,
        'status': 'ready',
    }

    # 复制模板
    shutil.copytree(TEMPLATE_DIR, dest)
    # 替换模板里的 id
    idx = os.path.join(dest, 'index.html')
    with io.open(idx, 'r', encoding='utf-8') as f:
        html = f.read()
    html = html.replace('data-module-id="template-demo"', 'data-module-id="%s"' % mid)
    html = html.replace('<title>模块模板 · 演示</title>', '<title>%s</title>' % meta['title'])
    html = html.replace('🎯 模块模板演示', '%s %s' % (meta['emoji'], meta['title']))
    with io.open(idx, 'w', encoding='utf-8', newline='\n') as f:
        f.write(html)

    with io.open(os.path.join(dest, 'module.json'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(meta, ensure_ascii=False, indent=2))

    text = read_catalog()
    if mid in [e['id'] for e in scan_entries(text)]:
        print('! catalog.js 中已存在 id=%s，跳过写入' % mid)
    else:
        write_catalog(insert_entry(text, build_entry(meta)))
        print('✓ 已写入 catalog.js')

    print('✓ 模块已创建：modules/%s/' % mid)
    print('  下一步：编辑 modules/%s/index.html 填充内容' % mid)
    return 0


def cmd_register(args):
    path = args.register
    if not os.path.isabs(path):
        path = os.path.join(ROOT, path)
    json_path = os.path.join(path, 'module.json')
    if not os.path.isfile(json_path):
        print('× 找不到 %s' % json_path)
        return 1
    with io.open(json_path, 'r', encoding='utf-8') as f:
        meta = json.load(f)
    meta = {k: v for k, v in meta.items() if not k.startswith('_')}
    mid = meta['id']

    text = read_catalog()
    hit = [e for e in scan_entries(text) if e['id'] == mid]
    if hit:
        print('! catalog.js 已存在 id=%s —— 请手动更新该条目（或先删除旧条目再执行本命令）' % mid)
        print('  当前条目：')
        print(text[hit[0]['span'][0]:hit[0]['span'][1]])
        return 2

    write_catalog(insert_entry(text, build_entry(meta)))
    print('✓ 已注册 %s → catalog.js' % mid)
    return 0


def cmd_list(args):
    entries = scan_entries(read_catalog())
    print('共 %d 个条目：' % len(entries))
    for e in entries:
        ok = '·' if not url_exists(e['url']) and e['status'] == 'planned' else \
             ('✓' if url_exists(e['url']) else '×')
        print('  %s %-18s [%-8s] %s' % (ok, e['id'], e['status'], e['url']))
    return 0


def url_exists(url):
    if not url:
        return False
    p = os.path.normpath(os.path.join(ROOT, url.lstrip('./').replace('/', os.sep)))
    return os.path.exists(p)


def cmd_check(args):
    entries = scan_entries(read_catalog())
    bad = 0
    ready_n = 0
    print('体检 catalog.js（共 %d 条）' % len(entries))
    for e in entries:
        if not e['url']:
            print('  ! %-18s 缺少 url 字段' % e['id'])
            bad += 1
            continue
        if url_exists(e['url']):
            print('  ✓ %-18s 已上线  %s' % (e['id'], e['url']))
            ready_n += 1
        elif e['status'] == 'planned':
            print('  · %-18s 规划中（文件未生成，正常）' % e['id'])
        else:
            print('  × %-18s 标为已上线但文件不存在 → %s' % (e['id'], e['url']))
            bad += 1
    print('\n已上线 %d 个，规划中 %d 个' % (ready_n, len(entries) - ready_n))
    print('结果：%s' % ('全部正常 ✅' if bad == 0 else '%d 条有问题 ⚠️' % bad))
    return 0 if bad == 0 else 3


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description='小悦饼学习工作台 · 模块脚手架')
    ap.add_argument('--id', help='模块唯一 id，例如 math-calc')
    ap.add_argument('--title')
    ap.add_argument('--subtitle', default='')
    ap.add_argument('--subject', default='综合')
    ap.add_argument('--grade', default='一年级')
    ap.add_argument('--type', default='lesson',
                    choices=['lesson', 'practice', 'game', 'print', 'book', 'tool'])
    ap.add_argument('--tags', default='', help='逗号分隔')
    ap.add_argument('--emoji', default='📘')
    ap.add_argument('--color', default='')
    ap.add_argument('--minutes', type=int, default=15)
    ap.add_argument('--desc', default='')
    ap.add_argument('--path', default='')
    ap.add_argument('--order', type=int, default=99)
    ap.add_argument('--register', help='把一个已有模块目录注册进 catalog.js')
    ap.add_argument('--list', action='store_true', help='列出所有已注册模块')
    ap.add_argument('--check', action='store_true', help='检查所有模块文件是否存在')
    args = ap.parse_args()

    if args.check:
        return cmd_check(args)
    if args.list:
        return cmd_list(args)
    if args.register:
        return cmd_register(args)
    if args.id:
        return cmd_new(args)

    ap.print_help()
    return 0


if __name__ == '__main__':
    sys.exit(main())
