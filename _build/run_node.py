# -*- coding: utf-8 -*-
"""跑 node 脚本，把 stdout + stderr 一起写进日志、并记录退出码。

为什么需要它：PowerShell 工具对 native 命令的 `2>&1` 抓不干净 ——
node 的报错（比如 require 失败、未捕获异常）会丢，日志里只剩一行空的 `exit=`，
排查时完全看不到原因。这里用 subprocess 合并两个流最稳。

用法：
    python _build/run_node.py _build/smoke_test.js [日志路径]
"""
import os
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from toolchain import node_exe, node_path   # noqa: E402

NODE = node_exe()
NODE_PATH = node_path()

script = sys.argv[1] if len(sys.argv) > 1 else os.path.join('_build', 'smoke_test.js')
if not os.path.isabs(script):
    script = os.path.join(ROOT, script)
log = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, '.workbuddy', 'tmp', 'node_run.txt')
if not os.path.isabs(log):
    log = os.path.join(ROOT, log)

env = dict(os.environ)
env['NODE_PATH'] = NODE_PATH
env['PYTHONIOENCODING'] = 'utf-8'

try:
    p = subprocess.run([NODE, script], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       env=env, cwd=ROOT, timeout=1200)
    out = p.stdout.decode('utf-8', 'replace')
    code = p.returncode
except subprocess.TimeoutExpired as e:
    out = (e.stdout or b'').decode('utf-8', 'replace') + '\n\n[超时被中断]'
    code = -9

with open(log, 'w', encoding='utf-8') as f:
    f.write(out)
    f.write('\n\nexit=%d\n' % code)

print('exit=%d  bytes=%d  log=%s' % (code, len(out), log))
