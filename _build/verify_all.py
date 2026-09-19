# -*- coding: utf-8 -*-
"""一键跑完所有验证关卡，输出 _build/verify_all.log

默认跑「静态四关」（不需要 PC-C 在线）：
   1. 脚手架一致性   new_module.py --check
   2. 引用与页面隔离 check_refs.py
   3. 孩子端/家长端  smoke_test.js
   4. 多端同步层     smoke_sync.js

加 --full 再跑两项（需要 PC-C 可达 / 会临时起本地服务）：
   5. 服务端 API     test_sync_server.py（本机临时实例，45 项）
   6. 线上终验       verify_http.py（经 WireGuard 打 8099）

用法：
   python _build/verify_all.py            # 改完前端先跑这个
   python _build/verify_all.py --full     # 发布前后跑这个

为什么要有这个脚本：关卡多了以后容易漏跑某一关，
而"漏跑"恰恰是本项目最容易踩的坑（事件绑定失效、同步静默丢数据都不会报错）。
"""
import glob
import io
import os
import shutil
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def _find_node():
    """找 node：XYB_NODE 环境变量 > PATH > 常见安装位置。"""
    env = os.environ.get('XYB_NODE')
    if env and os.path.exists(env):
        return env
    found = shutil.which('node')
    if found:
        return found
    for pat in (r'C:\Program Files\nodejs\node.exe',
                os.path.expanduser(r'~\.workbuddy\binaries\node\versions\*\node.exe')):
        hits = sorted(glob.glob(pat))
        if hits:
            return hits[-1]
    return 'node'          # 兜底：交给 PATH 解析


def _find_node_modules():
    """找装了 jsdom 的 node_modules：NODE_PATH 环境变量 > 常见位置。"""
    env = os.environ.get('NODE_PATH')
    if env:
        return env
    for cand in (os.path.expanduser(r'~\.workbuddy\binaries\node\workspace\node_modules'),):
        if os.path.isdir(os.path.join(cand, 'jsdom')):
            return cand
    return ''


NODE = _find_node()
NODE_PATH = _find_node_modules()
PY = sys.executable

GATES = [
    ('1. 脚手架一致性（catalog ↔ 文件）', [PY, os.path.join(HERE, 'new_module.py'), '--check']),
    ('2. 引用一致性 + 页面隔离', [PY, os.path.join(HERE, 'check_refs.py')]),
    ('3. 孩子端/家长端冒烟（jsdom）', [NODE, os.path.join(HERE, 'smoke_test.js')]),
    ('4. 多端同步冒烟（jsdom + 假服务端）', [NODE, os.path.join(HERE, 'smoke_sync.js')]),
]

FULL_GATES = [
    ('5. 服务端 API（本地临时实例）', [PY, os.path.join(HERE, 'test_sync_server.py')]),
    ('6. 线上终验（经 WireGuard 打 8099）', [PY, os.path.join(HERE, 'verify_http.py')]),
]

# verify_http.py 是巡检脚本，无论好坏都返回 0 —— 标成"信息项"，不计入成败
INFO_ONLY = {'6. 线上终验（经 WireGuard 打 8099）'}

# 有的子脚本把详细结果写进自己的日志文件（stdout 只打 done），
# 汇总时把它们一起收进来，否则总日志里只有 "done"，等于没记录
COMPANION_LOGS = {
    '5. 服务端 API（本地临时实例）': 'test_server.log',
    '6. 线上终验（经 WireGuard 打 8099）': 'verify3.log',
}


def run_gate(title, cmd):
    env = dict(os.environ)
    if NODE_PATH:
        env['NODE_PATH'] = NODE_PATH
    env['PYTHONIOENCODING'] = 'utf-8'
    try:
        p = subprocess.run(cmd, cwd=ROOT, env=env, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, timeout=900)
        out = p.stdout.decode('utf-8', 'replace')
        code = p.returncode
    except Exception as e:
        out = '运行失败：%r' % (e,)
        code = -1

    # 收编子脚本自己的日志（内容比 stdout 详细得多）
    extra = ''
    cname = COMPANION_LOGS.get(title)
    if cname:
        cpath = os.path.join(HERE, cname)
        if os.path.exists(cpath):
            with io.open(cpath, 'r', encoding='utf-8', errors='replace') as f:
                extra = '\n----- 明细（来自 _build/%s）-----\n' % cname + f.read()
    full = out + extra

    lines = [l for l in full.splitlines() if l.strip()]
    tail = lines[-4:] if lines else ['(无输出)']
    info = title in INFO_ONLY
    ok = (code == 0) or info

    body = ['', '#' * 60, '# %s' % title, '# ' + ' '.join(cmd), '#' * 60, full]
    print('\n'.join(body))
    print('  ── 结论: %s（exit=%s）' % ('通过 ✅' if ok else '失败 ❌', code))
    for l in tail:
        print('     ' + l)
    return {'title': title, 'ok': ok, 'code': code, 'tail': tail, 'body': body, 'info': info}


def main():
    gates = list(GATES) + (list(FULL_GATES) if '--full' in sys.argv else [])
    results = [run_gate(t, c) for t, c in gates]

    summary = ['', '=' * 60, '汇总（小悦饼学习工作台 · 验证关卡）', '=' * 60]
    bad = 0
    for r in results:
        mark = 'ℹ️  信息项' if r['info'] else ('通过 ✅' if r['ok'] else '失败 ❌')
        summary.append('  %-40s %s' % (r['title'], mark))
        if not r['ok']:
            bad += 1
            summary.append('      ↑ 最后几行： ' + ' | '.join(r['tail']))
    summary.append('')
    summary.append('  %d 项检查，%d 项失败' % (len(results), bad))
    summary.append('  结论：%s' % ('全部通过 ✅' if bad == 0 else '有失败 ❌'))
    text = '\n'.join(summary)
    print(text)

    log = '\n'.join('\n'.join(r['body']) for r in results) + '\n' + text
    with io.open(os.path.join(ROOT, '_build', 'verify_all.log'), 'w', encoding='utf-8') as f:
        f.write(log)
    print('\n日志：_build/verify_all.log')
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
