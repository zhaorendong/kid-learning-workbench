# -*- coding: utf-8 -*-
"""本机工具链定位（node / NODE_PATH）。

为什么需要它：WorkBuddy 的 managed runtime 目录里**带版本号**
（例如 `node\\versions\\22.22.2-5`），运行时一升级，老路径就直接消失。
脚本里硬编码的话不会报错，而是**静默失败** ——
命令找不到时 PowerShell 既不产生输出、也不设置 `$LASTEXITCODE`，
日志里只剩一行空的 `exit=`，非常难排查（2026-09-23 → 10-02 就踩了一次：
`22.22.2-3` 被换成了 `22.22.2-5`，所有 node 脚本突然"没有任何输出"）。
"""
import glob
import os
import shutil

WB = r'C:\Users\13552\.workbuddy\binaries'


def _ver_key(path):
    """把 `22.22.2-5` 这类目录名转成可比较的数字列表。"""
    name = os.path.basename(os.path.dirname(path))
    out = []
    for seg in name.replace('-', '.').replace('_', '.').split('.'):
        out.append(int(seg) if seg.isdigit() else 0)
    return out


def _newest(pattern):
    hits = glob.glob(pattern)
    if not hits:
        return None
    hits.sort(key=_ver_key)
    return hits[-1]


def node_exe():
    """按 环境变量 → managed 最新版 → 系统 node 的顺序找一个可用的 node.exe。"""
    cands = [
        os.environ.get('XYB_NODE'),
        _newest(os.path.join(WB, 'node', 'versions', '*', 'node.exe')),
        r'C:\Program Files\nodejs\node.exe',
        shutil.which('node'),
    ]
    for c in cands:
        if c and os.path.exists(c):
            return c
    raise SystemExit('找不到 node.exe —— 请检查 WorkBuddy 的 node runtime 是否已安装')


def node_path():
    """jsdom 等 npm 包的 NODE_PATH。"""
    p = os.environ.get('XYB_NODE_PATH') or os.path.join(WB, 'node', 'workspace', 'node_modules')
    return p


def python_exe():
    """带 paramiko 的那个解释器（部署脚本用）。"""
    import sys
    cands = [
        os.environ.get('XYB_PYTHON'),
        os.path.join(WB, 'python', 'envs', 'default', 'Scripts', 'python.exe'),
    ]
    for c in cands:
        if c and os.path.exists(c):
            return c
    return sys.executable


if __name__ == '__main__':
    print('node      :', node_exe())
    print('NODE_PATH :', node_path(), os.path.isdir(node_path()))
    print('python    :', python_exe())
