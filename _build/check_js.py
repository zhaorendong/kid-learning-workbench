# -*- coding: utf-8 -*-
"""对 JS 文件做语法检查（node --check），结果写 UTF-8 日志。

为什么不直接跑 `node --check`：
  本机 PowerShell 不回显 stdout，且 `>` 重定向会写成 UTF-16（Read 工具当二进制拒），
  内嵌多语言 here-string 又会被安全策略拦 —— 所以统一走 Python 捕获。

用法：
    python _build/check_js.py assets/core.js assets/parent.js ...
    python _build/check_js.py            # 不带参数则检查 assets/ 与 modules/ 下全部 js
"""
import glob
import io
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from toolchain import node_exe  # noqa: E402

NODE = node_exe()

if len(sys.argv) > 1:
    files = sys.argv[1:]
else:
    files = []
    for pat in ('assets/*.js', 'modules/*/*.js', '_build/*.js'):
        files += glob.glob(os.path.join(ROOT, pat))

lines, bad = [], 0
for f in files:
    p = f if os.path.isabs(f) else os.path.join(ROOT, f)
    if not os.path.isfile(p):
        lines.append('  ?  %-46s 不存在，跳过' % f)
        continue
    try:
        r = subprocess.run([NODE, '--check', p], capture_output=True, text=True,
                           encoding='utf-8', errors='replace', timeout=60)
        code, out = r.returncode, ((r.stdout or '') + (r.stderr or '')).strip()
    except Exception as ex:                       # node 都没起来也算失败，要看得见
        code, out = -1, repr(ex)
    rel = os.path.relpath(p, ROOT).replace('\\', '/')
    if not rel.endswith('.js'):
        # node --check 只吃 .js；HTML 里的内联脚本由 smoke_test.js 在 jsdom 里跑
        lines.append('  -- %-46s 非 .js，跳过（HTML 由 smoke_test.js 覆盖）' % rel)
        continue
    if code == 0:
        lines.append('  OK %-46s 语法正确' % rel)
    else:
        bad += 1
        lines.append('  XX %-46s exit=%d\n%s' % (rel, code, out))

report = '共检查 %d 个文件，失败 %d 个\n' % (len(files), bad) + '\n'.join(lines)
log = os.path.join(ROOT, '_build', 'check_js.log')
io.open(log, 'w', encoding='utf-8').write(report)
print('files=%d bad=%d log=%s' % (len(files), bad, log))
sys.exit(1 if bad else 0)