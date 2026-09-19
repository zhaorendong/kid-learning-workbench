#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
小悦饼学习工作台 · 引用一致性检查

静态站最容易出的三类错，这个脚本一次查出来：
  1. JS 里 getElementById 的 id 在 HTML 里被改名 / 删掉了
  2. HTML 引用的本地文件不存在
  3. ★ 孩子端页面里混进了家长端的控件（页面隔离被破坏）

用法：python _build/check_refs.py
"""
import io
import os
import re
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 页面 → (该页专属的 JS, 视图节点名)
# sync.js 两端共用（核心层 → 同步层 → 界面层 的加载顺序），所以两个页面都列上
PAGES = [
    ('index.html', ['assets/student.js', 'assets/core.js', 'assets/sync.js'],
     ['home', 'homework', 'courses', 'review', 'badges']),
    ('parent.html', ['assets/parent.js', 'assets/core.js', 'assets/sync.js'], []),
]
SDKJS = os.path.join(ROOT, 'assets', 'xyb-sdk.js')

# 运行时才创建的节点（弹层里的按钮等），HTML 里当然找不到，检查时忽略
DYNAMIC_IDS = {'doReset', 'pinSave', 'pinNew', 'pinNew2', 'avatarPick2'}

# 孩子端**绝对不能出现**的家长端控件 id（页面隔离的红线）
# 注意：'syncState' 不在这个清单里 —— 孩子端页脚有一行同步状态是**故意**的（只读显示），
# 但同步的口令/地址/回滚这些操作控件只能在家长端。
PARENT_ONLY_IDS = [
    'pKpi', 'pTable', 'pModules', 'setName', 'setGoal', 'setBreak',
    'swBreak', 'swSound', 'fileImport', 'guardState', 'gatePin',
    'mstBox', 'mstChips', 'pgName', 'pgAvatar',
    'syncUrl', 'syncKey', 'syncDetail', 'syncVersions',
]

problems = []


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def local_path(url):
    url = url.split('?')[0].split('#')[0]
    return os.path.normpath(os.path.join(ROOT, url.lstrip('./').replace('/', os.sep)))


def check_page(page, js_files, views):
    print('\n' + '=' * 52)
    print('▶ %s' % page)
    html = read(os.path.join(ROOT, page))
    ids = set(re.findall(r'id="([^"]+)"', html))
    print('  定义的 id：%d 个' % len(ids))

    # ---- 1) JS 用到的 id ----
    for rel in js_files:
        js = read(os.path.join(ROOT, rel.replace('/', os.sep)))
        used = set(re.findall(r"getElementById\('([^']+)'\)", js))
        missing = sorted([u for u in used if u not in ids and u not in DYNAMIC_IDS])
        label = os.path.basename(rel)
        if missing:
            for m in missing:
                print('    × %s 引用了不存在的 id： #%s' % (label, m))
                problems.append('%s: %s 引用缺失 id #%s' % (page, label, m))
        else:
            print('    ✓ %-12s 引用的 %d 个 id 全部存在' % (label, len(used)))

    # ---- 2) 动态拼接的视图节点 ----
    if views:
        for prefix in ('view-', 'nav-', 'tab-'):
            miss = [prefix + v for v in views if (prefix + v) not in ids]
            if miss:
                print('    × %s* 缺失：%s' % (prefix, ', '.join(miss)))
                problems.append('%s: %s* 缺失 %s' % (page, prefix, ','.join(miss)))
            else:
                print('    ✓ %s* %d 个视图节点齐全' % (prefix, len(views)))

    # ---- 3) 页面引用的本地文件 ----
    refs = sorted(set(re.findall(r'(?:href|src)="(\./[^"]+)"', html)))
    bad_refs = 0
    for r in refs:
        if not os.path.exists(local_path(r)):
            print('    × 引用的文件不存在：%s' % r)
            problems.append('%s 引用文件不存在：%s' % (page, r))
            bad_refs += 1
    print('    %s 引用的本地文件 %d 个%s'
          % ('✓' if bad_refs == 0 else '×', len(refs),
             '，全部存在' if bad_refs == 0 else '，缺失 %d 个' % bad_refs))
    return html


def check_isolation(student_html):
    """孩子端不能出现家长端控件，也不能加载家长端脚本"""
    print('\n' + '=' * 52)
    print('▶ 页面隔离检查（孩子端不得含家长端控件）')
    student_js = read(os.path.join(ROOT, 'assets', 'student.js'))
    core_js = read(os.path.join(ROOT, 'assets', 'core.js'))
    leaked = []
    for pid in PARENT_ONLY_IDS:
        if ('id="%s"' % pid) in student_html:
            leaked.append('#%s（HTML）' % pid)
        if ("getElementById('%s')" % pid) in student_js or ("getElementById('%s')" % pid) in core_js:
            leaked.append('#%s（JS）' % pid)
    if leaked:
        print('    × 孩子端混入家长端控件：%s' % ', '.join(leaked))
        problems.append('孩子端混入家长端控件：%s' % ','.join(leaked))
    else:
        print('    ✓ 孩子端 %d 个家长端控件的 id 一个都没有' % len(PARENT_ONLY_IDS))

    if 'parent.js' in student_html:
        print('    × 孩子端加载了 parent.js')
        problems.append('孩子端加载了 parent.js')
    else:
        print('    ✓ 孩子端没有加载 parent.js')

    if 'parent.html' not in student_html:
        print('    × 孩子端找不到家长入口链接')
        problems.append('孩子端没有家长入口链接')
    else:
        print('    ✓ 孩子端保留了唯一的家长入口链接')

    if 'core.js' not in student_html or 'student.js' not in student_html:
        print('    × 孩子端缺少 core.js 或 student.js')
        problems.append('孩子端脚本引入不完整')
    else:
        print('    ✓ 孩子端脚本引入完整（core.js + student.js）')


def check_modules():
    """各模块是否引用了 SDK，且 data-module-id 与注册表一致"""
    cat = read(os.path.join(ROOT, 'assets', 'catalog.js'))
    entries = re.findall(r'(?m)^    \{\n(.*?)\n    \}(?:,)?\n', cat, re.S)
    pairs = []
    for b in entries:
        gid = re.search(r"id:\s*'([^']+)'", b)
        gurl = re.search(r"url:\s*'([^']+)'", b)
        gst = re.search(r"status:\s*'([^']+)'", b)
        if gid and gurl:
            pairs.append((gid.group(1), gurl.group(1), gst.group(1) if gst else 'ready'))

    print('\n' + '=' * 52)
    print('▶ 已上线模块的 SDK 接入检查')
    for mid, url, status in pairs:
        if status != 'ready':
            continue
        p = local_path(url)
        if not os.path.exists(p):
            continue
        content = read(p)
        if 'xyb-sdk.js' not in content:
            print('    · %-16s 未接入 SDK（手动打勾模式）' % mid)
            continue
        got = re.search(r'data-module-id="([^"]+)"', content)
        if got and got.group(1) == mid:
            print('    ✓ %-16s SDK 已接入，id 一致' % mid)
        else:
            print('    × %-16s SDK id 不匹配：HTML=%s / catalog=%s'
                  % (mid, got.group(1) if got else '无', mid))
            problems.append('模块 %s 的 data-module-id 不匹配' % mid)


def main():
    print('小悦饼学习工作台 · 引用一致性检查')
    student_html = ''
    for page, js_files, views in PAGES:
        html = check_page(page, js_files, views)
        if page == 'index.html':
            student_html = html

    check_isolation(student_html)
    check_modules()

    sdk = read(SDKJS)
    print('\n▶ SDK 自检')
    print('    %s 悬浮返回按钮' % ('✓' if "getElementById('xyb-back')" in sdk else '×'))
    print('    %s 错题上报字段（q / answer / my）'
          % ('✓' if ("q: o.q" in sdk and 'my: o.my' in sdk) else '×'))
    print('    %s 朗读能力 XYB.speak'
          % ('✓' if 'speak: function' in sdk else '×'))

    print('\n' + '=' * 52)
    if problems:
        print('发现 %d 个问题：' % len(problems))
        for p in problems:
            print('  - %s' % p)
        return 1
    print('结果：引用关系与页面隔离全部正常 ✅')
    return 0


if __name__ == '__main__':
    sys.exit(main())
