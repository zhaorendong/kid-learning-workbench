# -*- coding: utf-8 -*-
"""add_link.py 的往返自测：加 → 读 → 改 → 删 → 读，全程只碰临时目录里的副本。

★ 为什么用**合成样本**而不是复制真links.js：
    早先这版测试是shutil.copy2 真文件到临时目录再改，结果有一次
    测试自己的写回逻辑把数据写进了**真** links.js（临时目录里的路径算错了一处）。
    add_link.py 一旦改坏links.js，页面会直接白屏且不报错 —— 不能拿真文件做赌注。
    现在样本写在测试里，根上不可能碰到项目文件。

★ 关键：**必须跑临时目录里那份脚本副本**，不能跑真脚本。
    上一版栽在这里：subprocess 传了 cwd=tmp，但脚本路径用的是真的
    _build/add_link.py —— 而 add_link.py 是用 __file__ 推导 LINKS_JS 的，
    **cwd 传什么都没用**，于是每一步 add/del 都写进了真 links.js
    （真文件里一度出现 b.example.com 的测试数据）。
    副本跑起来后，__file__ 在 tmp 里，LINKS_JS 自然也在 tmp 里，才是真的隔离。

要验证的（"跑一次没报错"不足以证明安全）：
    1. 写入后的文件仍是**合法 JSON**（能被 json.loads 读回）
    2. 文件头部的说明注释没被冲掉
    3. 加/改/删之后条数与字段都对
    4. 归一化去重：末尾 /、查询串、片段的变体都算同一条
    5. 非法输入被拦住且**没有写文件**
    6. 真links.js 自始至终一个字节都没变
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC_SCRIPT = os.path.join(HERE, 'add_link.py')
PY = sys.executable

FAILS = []
OKN = [0]


def ok(cond, name, extra=''):
    OKN[0] += 1
    if cond:
        print('  OK %-52s %s' % (name, extra))
    else:
        FAILS.append(name)
        print('  XX %-52s %s' % (name, extra))


# 合成样本：头部注释必须保留；备注里塞了中文引号和转义双引号，
# 用来验证 json.dumps/loads 往返不会把内容搞坏。
HEAD = '''/* ==========================================================================
   头部说明注释，必须保留
   ========================================================================== */

window.XYB_LINKS = {
  "generatedAt": "2026-10-02",
  "items": [
    {
      "url": "https://a.example.com/x/",
      "title": "第1课",
      "subject": "综合",
      "note": "老师原话：带「引号」与\\"双引号\\" 也要能原样存住",
      "addedAt": "2026-10-02"
    }
  ]
};
'''
# 读回来之后这条备注**应该**是下面这个值：
#   文件里写的是 \"双引号\"，JSON 解析后就是 "双引号"（反斜杠是转义符，不该留下）
NOTE1 = '老师原话：带「引号」与"双引号" 也要能原样存住'


def run(args, cwd, script):
    """⚠️ script 必须是临时目录里的副本，不能传真脚本。"""
    r = subprocess.run([PY, script] + args, cwd=cwd, capture_output=True,
                       text=True, encoding='utf-8', errors='replace')
    return r.returncode, (r.stdout or '') + (r.stderr or '')


def load(path):
    """按 add_link.py 相同的规则读回来 —— 读不回来就是真坏了。"""
    src = io.open(path, encoding='utf-8').read()
    i = src.index('window.XYB_LINKS')
    j = src.rindex('};')
    return json.loads(src[src.index('{', i):j + 1])


def save(path, data):
    """写回时保留头部注释。

    ⚠️ j 必须指向 `;` 而不是 `}`：json.dumps 自己已经输出了完整的 {...}，
    若再把 src[j:]（= "};"）拼上去就变成 {...}}，文件从此不是合法 JSON，
    后面所有步骤都会因read_links() 抛 SystemExit 而连环失败。
    """
    src = io.open(path, encoding='utf-8').read()
    i, j = src.index('{'), src.rindex('};') + 1
    with io.open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(src[:i] + json.dumps(data, ensure_ascii=False, indent=2) + src[j:])


def main():
    tmp = tempfile.mkdtemp(prefix='xyb_link_test_')
    real = os.path.join(ROOT, 'modules', 'preview-1', 'links.js')
    bak = io.open(real, encoding='utf-8').read()
    try:
        # 造一个和真实模块同构的目录，样本是合成的，不复制真文件
        os.makedirs(os.path.join(tmp, 'modules', 'preview-1'))
        os.makedirs(os.path.join(tmp, '_build'))
        target = os.path.join(tmp, 'modules', 'preview-1', 'links.js')
        with io.open(target, 'w', encoding='utf-8', newline='\n') as f:
            f.write(HEAD)
        # ★ 跑这份副本 —— __file__ 在 tmp 里，LINKS_JS 才落在 tmp 里
        script = os.path.join(tmp, '_build', 'add_link.py')
        shutil.copy2(SRC_SCRIPT, script)

        print('\n[0] 隔离前提')
        ok(os.path.isfile(script), '临时目录里有脚本副本')
        ok(not os.path.samefile(os.path.dirname(script), HERE),
           '副本不在真_build 目录里')

        print('\n[1] 初始状态可读')
        d = load(target)
        ok(len(d['items']) == 1, '初始 1 条', str(len(d['items'])))
        ok('「引号」' in d['items'][0]['note'], '含中文引号的备注原样读回')
        # 转义检查：文件里写 \"双引号\"，JSON 解析后应是 "双引号"（无反斜杠）
        ok(d['items'][0]['note'] == NOTE1, '含转义双引号的备注解析正确',
           repr(d['items'][0]['note'][-12:]))

        print('\n[2] 加一条新的')
        rc, out = run(['https://b.example.com/y/', '--title', '第2课',
                       '--subject', '数学', '--note', '备注二'], tmp, script)
        ok(rc == 0, 'add 返回 0', 'exit=%d' % rc)
        d = load(target)
        ok(len(d['items']) == 2, '变成 2 条', str(len(d['items'])))
        ok(d['items'][0]['url'] == 'https://b.example.com/y/', '新的排在最前（倒序）')
        ok(d['items'][0]['subject'] == '数学', '学科写入正确')
        ok('/* ====' in io.open(target, encoding='utf-8').read(),
           '头部注释被保留')

        print('\n[3] 重复加同一条要被拦住')
        rc, out = run(['https://b.example.com/y/', '--title', '重复'], tmp, script)
        ok(rc != 0, '重复加返回非 0', 'exit=%d' % rc)
        ok('已经有这条链接' in out, '提示"已经有了"')
        ok(len(load(target)['items']) == 2, '条数没变（没写入）')

        print('\n[4] 末尾 / 与查询串不同也算重复（归一化去重）')
        # 这三条与第 2 步那条归一化后都是 b.example.com/y
        # ⚠️ 带查询串那条是最容易漏的：先 /+$ 再去 ? 的话会算出 y/ 和 y 两个 key
        for variant, why in [('https://b.example.com/y', '少一个末尾斜杠'),
                             ('https://b.example.com/y/?from=chat', '多了查询串'),
                             ('https://b.example.com/y/#part', '多了片段')]:
            rc, out = run([variant, '--title', '重复'], tmp, script)
            ok(rc != 0, '归一化后判为重复：%s' % why, 'exit=%d' % rc)
        ok(len(load(target)['items']) == 2, '三种变体都没写入')

        print('\n[5] --force 覆盖而不是新增')
        rc, out = run(['https://b.example.com/y/', '--force',
                       '--title', '第2课·改'], tmp, script)
        ok(rc == 0, 'force 返回 0', 'exit=%d' % rc)
        d = load(target)
        ok(len(d['items']) == 2, '仍是 2 条', str(len(d['items'])))
        ok(d['items'][0]['title'] == '第2课·改', '标题已更新')
        ok(d['items'][0]['subject'] == '数学', '未给的字段保留旧值')
        ok(d['items'][0]['note'] == '备注二', '未给的备注保留旧值')

        print('\n[6] 非法输入被拦住且不写文件')
        before = io.open(target, encoding='utf-8').read()
        for bad, why in [('ftp://x.com/', '非 http(s)'),
                         ('https://a.com/ x', '含空格'),
                         ('', '空链接')]:
            rc, out = run([bad, '--title', 'T'], tmp, script)
            ok(rc != 0, '拦住：%s' % why, 'exit=%d' % rc)
        ok(io.open(target, encoding='utf-8').read() == before,
           '非法输入没有改动文件')

        print('\n[7] 删一条')
        rc, out = run(['--del', 'https://a.example.com/x/'], tmp, script)
        ok(rc == 0, 'del 返回 0', 'exit=%d' % rc)
        d = load(target)
        ok(len(d['items']) == 1, '剩 1 条', str(len(d['items'])))
        ok(d['items'][0]['url'] == 'https://b.example.com/y/', '删对了')

        print('\n[8] 删不存在的要报错')
        rc, out = run(['--del', 'https://zzz.example.com/'], tmp, script)
        ok(rc != 0, '删除不存在返回非 0', 'exit=%d' % rc)

        print('\n[9] --list 能看出重复与格式问题')
        # 手工塞一条归一化后与已有那条相同的链接（绕过 add 的重复保护，
        # 模拟"清单被人工改坏"的场景 —— list 必须能报出来）
        d = load(target)
        d['items'].append({'url': 'https://b.example.com/y', 'title': '重复',
                           'subject': '综合', 'note': '', 'addedAt': '2026-10-02'})
        save(target, d)
        rc, out = run(['--list'], tmp, script)
        ok(rc == 0, 'list 返回 0')
        ok('归一化后重复' in out, 'list 报出了重复')
        ok(os.path.isfile(os.path.join(tmp, '_build', 'add_link.log')), '写了日志文件')

        print('\n[10] --dry-run 不写文件')
        before = io.open(target, encoding='utf-8').read()
        rc, out = run(['https://c.example.com/z/', '--dry-run'], tmp, script)
        ok(rc == 0, 'dry-run 返回 0')
        ok('https://c.example.com/z/' in out, 'dry-run 打印了将加入的链接')
        ok(io.open(target, encoding='utf-8').read() == before, 'dry-run 没改文件')

        print('\n[11] 真文件没被动过')
        ok(io.open(real, encoding='utf-8').read() == bak, '线上 links.js 原样未改')

        print('\n' + '=' * 56)
        print('共 %d 项，失败 %d 项' % (OKN[0], len(FAILS)))
        for f in FAILS:
            print('  × %s' % f)
        print('结果：%s' % ('全部通过 ✅' if not FAILS else '有失败 ❌'))
        return 1 if FAILS else 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())