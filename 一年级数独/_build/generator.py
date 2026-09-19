# -*- coding: utf-8 -*-
"""
小学一年级数独题库生成器
================================================================
支持三种规格：
  4x4  宫格 2x2   数字 1-4
  6x6  宫格 2行3列 数字 1-6
  9x9  宫格 3x3   数字 1-9

每道题同时满足两个硬条件：
  1) 唯一解
  2) 可以用【唯一余数法(naked single)】+【隐藏单数法/排除法(hidden single)】
     这两种最基础技巧一路推到底 —— 保证一年级孩子不会"卡死"
"""
import json
import os
import random
import sys
import time

# ----------------------------------------------------------------------
# 规格定义
# ----------------------------------------------------------------------
SPECS = [
    # key,   n, br(宫行数), bc(宫列数), 目标提示数(易/中/难), 每题名额
    ("4x4", 4, 2, 2, (9, 7, 5), 10),
    ("6x6", 6, 2, 3, (20, 16, 12), 10),
    ("9x9", 9, 3, 3, (38, 32, 28), 10),
]
LEVELS = ["easy", "medium", "hard"]
LEVEL_CN = {"easy": "入门", "medium": "进阶", "hard": "挑战"}


def box_index(r, c, br, bc, n):
    """返回 (r,c) 所属宫格的编号。宫数恰好等于 n。"""
    return (r // br) * (n // bc) + (c // bc)


def build_units(n, br, bc):
    """构造所有'单元'(行/列/宫)，每个单元是 (r,c) 坐标列表。用于隐藏单数法。"""
    units = []
    for r in range(n):
        units.append([(r, c) for c in range(n)])
    for c in range(n):
        units.append([(r, c) for r in range(n)])
    for b in range(n):
        cells = []
        for r in range(n):
            for c in range(n):
                if box_index(r, c, br, bc, n) == b:
                    cells.append((r, c))
        units.append(cells)
    return units


# ----------------------------------------------------------------------
# 求解器：统计解的个数（最多数到 limit 个）
# ----------------------------------------------------------------------
def count_solutions(grid, n, br, bc, limit=2):
    rows = [0] * n
    cols = [0] * n
    boxes = [0] * n
    empties = []
    for r in range(n):
        for c in range(n):
            v = grid[r][c]
            if v:
                bit = 1 << v
                rows[r] |= bit
                cols[c] |= bit
                boxes[box_index(r, c, br, bc, n)] |= bit
            else:
                empties.append((r, c))

    full = (1 << (n + 1)) - 2
    count = 0

    def rec():
        nonlocal count
        best = None
        best_mask = 0
        best_cnt = 99
        for (r, c) in empties:
            if grid[r][c]:
                continue
            m = full & ~(rows[r] | cols[c] | boxes[box_index(r, c, br, bc, n)])
            cnt = bin(m).count("1")
            if cnt == 0:
                return
            if cnt < best_cnt:
                best_cnt, best, best_mask = cnt, (r, c), m
                if cnt == 1:
                    break
        if best is None:
            count += 1
            return
        r, c = best
        b = box_index(r, c, br, bc, n)
        m = best_mask
        while m:
            bit = m & (-m)
            m ^= bit
            grid[r][c] = bit.bit_length() - 1
            rows[r] |= bit
            cols[c] |= bit
            boxes[b] |= bit
            rec()
            grid[r][c] = 0
            rows[r] ^= bit
            cols[c] ^= bit
            boxes[b] ^= bit
            if count >= limit:
                return

    rec()
    return count


# ----------------------------------------------------------------------
# 生成一个完整解
# ----------------------------------------------------------------------
def generate_full(n, br, bc, rng):
    grid = [[0] * n for _ in range(n)]
    rows = [0] * n
    cols = [0] * n
    boxes = [0] * n
    full = (1 << (n + 1)) - 2

    def rec(idx):
        if idx == n * n:
            return True
        r, c = divmod(idx, n)
        b = box_index(r, c, br, bc, n)
        mask = full & ~(rows[r] | cols[c] | boxes[b])
        cands = []
        m = mask
        while m:
            bit = m & (-m)
            m ^= bit
            cands.append(bit)
        rng.shuffle(cands)
        for bit in cands:
            grid[r][c] = bit.bit_length() - 1
            rows[r] |= bit
            cols[c] |= bit
            boxes[b] |= bit
            if rec(idx + 1):
                return True
            grid[r][c] = 0
            rows[r] ^= bit
            cols[c] ^= bit
            boxes[b] ^= bit
        return False

    rec(0)
    return grid


# ----------------------------------------------------------------------
# 人类解法（只用唯一余数法 + 隐藏单数法），验证"一年级可解"
# ----------------------------------------------------------------------
def human_solveable(grid, n, br, bc):
    g = [row[:] for row in grid]
    full = (1 << (n + 1)) - 2
    units = build_units(n, br, bc)

    while True:
        empties = [(r, c) for r in range(n) for c in range(n) if g[r][c] == 0]
        if not empties:
            return True

        rows = [0] * n
        cols = [0] * n
        boxes = [0] * n
        for r in range(n):
            for c in range(n):
                v = g[r][c]
                if v:
                    bit = 1 << v
                    rows[r] |= bit
                    cols[c] |= bit
                    boxes[box_index(r, c, br, bc, n)] |= bit

        cand = {}
        for (r, c) in empties:
            m = full & ~(rows[r] | cols[c] | boxes[box_index(r, c, br, bc, n)])
            if m == 0:
                return False
            cand[(r, c)] = m

        # --- 唯一余数法：某格只剩一个可能是数字 ---
        placed = False
        for (r, c) in empties:
            m = cand[(r, c)]
            if m & (m - 1) == 0:
                g[r][c] = m.bit_length() - 1
                placed = True
        if placed:
            continue

        # --- 隐藏单数法/排除法：某单元里某个数字只有一处能放 ---
        filled = False
        for unit in units:
            for v in range(1, n + 1):
                bit = 1 << v
                spots = [(r, c) for (r, c) in unit if g[r][c] == 0 and cand[(r, c)] & bit]
                if len(spots) == 1:
                    r, c = spots[0]
                    g[r][c] = v
                    filled = True
                    break
            if filled:
                break
        if not filled:
            return False


# ----------------------------------------------------------------------
# 挖空成题
# ----------------------------------------------------------------------
def carve(solution, n, br, bc, target_clues, rng):
    puzzle = [row[:] for row in solution]
    clues = n * n
    cells = [(r, c) for r in range(n) for c in range(n)]
    rng.shuffle(cells)
    for (r, c) in cells:
        if clues <= target_clues:
            break
        saved = puzzle[r][c]
        puzzle[r][c] = 0
        if count_solutions([row[:] for row in puzzle], n, br, bc, limit=2) == 1:
            clues -= 1
        else:
            puzzle[r][c] = saved

    # 逐步回填，直到满足"一年级可解"
    holes = [(r, c) for r in range(n) for c in range(n) if puzzle[r][c] == 0]
    rng.shuffle(holes)
    refill = 0
    while not human_solveable(puzzle, n, br, bc) and holes:
        r, c = holes.pop()
        puzzle[r][c] = solution[r][c]
        refill += 1
        if refill > n * n:
            break
    return puzzle, clues + refill


def fingerprint(puzzle):
    return tuple(tuple(row) for row in puzzle)


def generate_puzzles():
    rng = random.Random(20260911)
    data = {"4x4": [], "6x6": [], "9x9": []}
    seen = {"4x4": set(), "6x6": set(), "9x9": set()}

    for (key, n, br, bc, clue_targets, per_level) in SPECS:
        t0 = time.time()
        for li, level in enumerate(LEVELS):
            target = clue_targets[li]
            made = 0
            attempts = 0
            while made < per_level:
                attempts += 1
                if attempts > 4000:
                    raise RuntimeError(f"{key}/{level} 生成失败")
                sol = generate_full(n, br, bc, rng)
                puz, clues = carve(sol, n, br, bc, target, rng)
                fp = fingerprint(puz)
                if fp in seen[key]:
                    continue
                seen[key].add(fp)
                made += 1
                data[key].append({
                    "id": f"{key}-{level[:1].upper()}{made:02d}",
                    "size": n, "br": br, "bc": bc,
                    "level": level, "level_cn": LEVEL_CN[level],
                    "clues": clues,
                    "puzzle": puz,
                    "solution": sol,
                })
            print(f"  {key} {level:6s} target={target:2d} 完成 {per_level} 题", flush=True)
        print(f"{key} 全部完成，用时 {time.time()-t0:.1f}s，共 {len(data[key])} 题", flush=True)

    return data


if __name__ == "__main__":
    out_dir = os.path.dirname(os.path.abspath(__file__))
    print("开始生成题目 ...", flush=True)
    payload = generate_puzzles()
    out_path = os.path.join(out_dir, "puzzles.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    total = sum(len(v) for v in payload.values())
    print(f"\n已写出 {out_path}，共 {total} 题", flush=True)
    for k, v in payload.items():
        from collections import Counter
        c = Counter(p["level_cn"] for p in v)
        avg = sum(p["clues"] for p in v) / len(v)
        print(f"  {k}: {len(v)} 题  {dict(c)}  平均提示数 {avg:.1f}", flush=True)
