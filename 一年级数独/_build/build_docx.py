# -*- coding: utf-8 -*-
"""
把 puzzles.json 渲染成 A4 可打印的 Word 题库（含答案页）
- 4x4 : 每页 4 题（2x2），格宽 1.8cm
- 6x6 : 每页 4 题（2x2），格宽 1.4cm
- 9x9 : 每页 2 题（1x2），格宽 1.25cm
- 每页顶部有「姓名 / 日期」栏
- 答案页在最后，小格子排版
"""
import json
import math
import os

from docx import Document
from docx.shared import Cm, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

# ----------------------------------------------------------------------
# 线型 / 颜色
# ----------------------------------------------------------------------
THIN  = {'sz': 6,  'val': 'single', 'color': '7C90A8', 'space': 0}   # 格间细线
THICK = {'sz': 18, 'val': 'single', 'color': '1F3350', 'space': 0}   # 宫线 / 外框
NONE  = {'sz': 0,  'val': 'none',   'color': 'auto',   'space': 0}   # 无框

DARK  = RGBColor(0x14, 0x22, 0x33)   # 题目给定数字
MUTED = RGBColor(0x64, 0x74, 0x8B)   # 说明文字
ACCENT = RGBColor(0x1D, 0x4E, 0xD8)  # 标题蓝

FONT_CN = '微软雅黑'
FONT_NUM = 'Arial'

AVAIL_W = 18.0        # 可用宽度 cm
AVAIL_H = 26.2        # 可用高度 cm（留足余量，避免整页溢出产生空白页）

# 每个规格的排版参数
LAYOUT = {
    '4x4': dict(cols=2, rows=2, cell=1.80, font=22, per_page=4,
                title='4×4 入门', tip='数字只有 1、2、3、4，每排、每列、每间小房子都不能重复。'),
    '6x6': dict(cols=2, rows=2, cell=1.40, font=16, per_page=4,
                title='6×6 进阶', tip='数字变成 1–6，小房子是 2 行 3 列。做之前先深呼吸，一格一格来。'),
    '9x9': dict(cols=1, rows=2, cell=1.25, font=14, per_page=2,
                title='9×9 挑战', tip='和大人玩的一样！数字是 1–9，小房子是 3×3。做不完没关系，慢慢来。'),
}
LEVEL_TITLE = {'easy': '第一组 · 入门', 'medium': '第二组 · 进阶', 'hard': '第三组 · 挑战'}
LEVEL_STAR = {'easy': '★☆☆', 'medium': '★★☆', 'hard': '★★★'}


# ----------------------------------------------------------------------
# 低层 XML 工具
# ----------------------------------------------------------------------
def _set_borders(tcPr, spec_map):
    """spec_map: {'top':THIN, 'left':THICK, ...}"""
    old = tcPr.find(qn('w:tcBorders'))
    if old is not None:
        tcPr.remove(old)
    borders = OxmlElement('w:tcBorders')
    for tag in ('top', 'left', 'bottom', 'right'):
        el = OxmlElement('w:' + tag)
        spec = spec_map.get(tag, NONE)
        el.set(qn('w:val'), spec['val'])
        el.set(qn('w:sz'), str(spec['sz']))
        el.set(qn('w:space'), str(spec['space']))
        el.set(qn('w:color'), spec['color'])
        borders.append(el)
    tcPr.append(borders)


def style_cell(cell, borders=None, bg=None, margin=0, valign=WD_ALIGN_VERTICAL.CENTER):
    tcPr = cell._tc.get_or_add_tcPr()
    if borders is not None:
        _set_borders(tcPr, borders)
    if bg:
        shd = OxmlElement('w:shd')
        shd.set(qn('w:val'), 'clear')
        shd.set(qn('w:color'), 'auto')
        shd.set(qn('w:fill'), bg)
        tcPr.append(shd)
    if margin is not None:
        mar = OxmlElement('w:tcMar')
        for tag in ('top', 'left', 'bottom', 'right'):
            n = OxmlElement('w:' + tag)
            n.set(qn('w:w'), str(int(margin * 567)))
            n.set(qn('w:type'), 'dxa')
            mar.append(n)
        tcPr.append(mar)
    cell.vertical_alignment = valign


def fix_table(table, widths_cm):
    """固定列宽 + 固定布局"""
    tbl = table._tbl
    tblPr = tbl.tblPr
    table.autofit = False

    for e in tblPr.findall(qn('w:tblW')):
        tblPr.remove(e)
    tblW = OxmlElement('w:tblW')
    tblW.set(qn('w:w'), str(int(sum(widths_cm) * 567)))
    tblW.set(qn('w:type'), 'dxa')
    tblPr.append(tblW)

    for e in tblPr.findall(qn('w:tblLayout')):
        tblPr.remove(e)
    lay = OxmlElement('w:tblLayout')
    lay.set(qn('w:type'), 'fixed')
    tblPr.append(lay)

    grid = tbl.find(qn('w:tblGrid'))
    if grid is not None:
        cols = grid.findall(qn('w:gridCol'))
        for gc, w in zip(cols, widths_cm):
            gc.set(qn('w:w'), str(int(w * 567)))

    for row in table.rows:
        for i, cell in enumerate(row.cells):
            if i < len(widths_cm):
                cell.width = Cm(widths_cm[i])


def no_borders(table):
    tblPr = table._tbl.tblPr
    old = tblPr.find(qn('w:tblBorders'))
    if old is not None:
        tblPr.remove(old)
    b = OxmlElement('w:tblBorders')
    for tag in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        e = OxmlElement('w:' + tag)
        e.set(qn('w:val'), 'none')
        e.set(qn('w:sz'), '0')
        e.set(qn('w:space'), '0')
        e.set(qn('w:color'), 'auto')
        b.append(e)
    tblPr.append(b)
    # 表格本身也不要单元格默认间距
    old = tblPr.find(qn('w:tblCellMar'))
    if old is not None:
        tblPr.remove(old)
    mar = OxmlElement('w:tblCellMar')
    for tag in ('top', 'left', 'bottom', 'right'):
        n = OxmlElement('w:' + tag)
        n.set(qn('w:w'), '0')
        n.set(qn('w:type'), 'dxa')
        mar.append(n)
    tblPr.append(mar)


def row_height(row, cm):
    trPr = row._tr.get_or_add_trPr()
    old = trPr.find(qn('w:trHeight'))
    if old is not None:
        trPr.remove(old)
    h = OxmlElement('w:trHeight')
    h.set(qn('w:val'), str(int(cm * 567)))
    h.set(qn('w:hRule'), 'atLeast')
    trPr.append(h)


def no_split(row):
    """禁止该行跨页断开"""
    trPr = row._tr.get_or_add_trPr()
    e = OxmlElement('w:cantSplit')
    trPr.insert(0, e)


def tight(p, size=None, align=None, before=0, after=0, spacing=1.0):
    pf = p.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = spacing
    if align is not None:
        p.alignment = align
    if size is not None:
        for r in p.runs:
            r.font.size = Pt(size)
    return p


def set_run(run, text, size, bold=False, color=DARK, font=FONT_NUM):
    run.text = text
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.name = font
    rPr = run._element.get_or_add_rPr()
    rf = rPr.find(qn('w:rFonts'))
    if rf is None:
        rf = OxmlElement('w:rFonts')
        rPr.append(rf)
    rf.set(qn('w:ascii'), font)
    rf.set(qn('w:hAnsi'), font)
    rf.set(qn('w:eastAsia'), FONT_CN)
    return run


# ----------------------------------------------------------------------
# 数独网格
# ----------------------------------------------------------------------
def draw_sudoku(parent, grid, n, br, bc, cell_cm, font_pt, given_only=True, fill_char=''):
    """在 parent（Document 或 _Cell）里画一个数独表格"""
    t = parent.add_table(rows=n, cols=n)
    fix_table(t, [cell_cm] * n)
    no_borders(t)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER

    for r in range(n):
        row = t.rows[r]
        row_height(row, cell_cm)
        no_split(row)
        for c in range(n):
            cell = row.cells[c]
            style_cell(cell, borders={
                'top':    THICK if r % br == 0 else THIN,
                'bottom': THICK if (r + 1) % br == 0 or r == n - 1 else THIN,
                'left':   THICK if c % bc == 0 else THIN,
                'right':  THICK if (c + 1) % bc == 0 or c == n - 1 else THIN,
            }, margin=0.02)
            p = cell.paragraphs[0]
            tight(p, align=WD_ALIGN_PARAGRAPH.CENTER, spacing=1.0)
            v = grid[r][c]
            if v:
                set_run(p.add_run(), str(v), font_pt, bold=False, color=DARK, font=FONT_NUM)
            elif fill_char:
                set_run(p.add_run(), fill_char, font_pt * 0.55, color=MUTED, font=FONT_NUM)
    return t


def puzzle_title_row(cell, label, level_cn, star, size=10.5):
    """题目上方的编号行"""
    p = cell.paragraphs[0]
    tight(p, align=WD_ALIGN_PARAGRAPH.CENTER, spacing=1.0, after=3)
    set_run(p.add_run(), label, size, bold=True, color=ACCENT, font=FONT_CN)
    set_run(p.add_run(), '　', size, font=FONT_CN)
    set_run(p.add_run(), level_cn + ' ' + star, size * 0.92, color=MUTED, font=FONT_CN)
    return p


def tail_paragraph(cell, size=2):
    """保证 cell 以段落结尾（Word 规范），并尽量不占高度"""
    p = cell.add_paragraph()
    tight(p, align=WD_ALIGN_PARAGRAPH.CENTER, spacing=1.0)
    set_run(p.add_run(), '', size, font=FONT_CN)
    return p


def blank_cell_writer(cell, text, size, color, bold=False, align=WD_ALIGN_PARAGRAPH.CENTER,
                      before=0, after=0, font=FONT_CN):
    p = cell.paragraphs[0]
    tight(p, align=align, before=before, after=after, spacing=1.0)
    set_run(p.add_run(), text, size, bold=bold, color=color, font=font)
    return p


# ----------------------------------------------------------------------
# 页面元素
# ----------------------------------------------------------------------
def add_page_header(doc, part_title, page_no, total_pages, level_text=None):
    """页首：姓名 / 日期  + 部分标题"""
    t = doc.add_table(rows=1, cols=3)
    fix_table(t, [6.6, 6.0, 5.4])
    no_borders(t)
    row_height(t.rows[0], 0.72)

    c0 = t.rows[0].cells[0]
    blank_cell_writer(c0, '姓名：____________', 10.5, MUTED, align=WD_ALIGN_PARAGRAPH.LEFT)
    c1 = t.rows[0].cells[1]
    blank_cell_writer(c1, '日期：______________', 10.5, MUTED, align=WD_ALIGN_PARAGRAPH.LEFT)
    c2 = t.rows[0].cells[2]
    blank_cell_writer(c2, part_title + '　第 %d / %d 页' % (page_no, total_pages),
                      10, MUTED, align=WD_ALIGN_PARAGRAPH.RIGHT)
    for c in (c0, c1, c2):
        style_cell(c, borders={'top': NONE, 'left': NONE, 'bottom': THIN, 'right': NONE},
                   margin=0.0, valign=WD_ALIGN_VERTICAL.BOTTOM)

    p = doc.add_paragraph()
    tight(p, spacing=1.0, before=0, after=0)
    set_run(p.add_run(), '', 3, font=FONT_CN)
    return t


def add_band(doc, text, size=15, color=ACCENT, before=4, after=6, bold=True, align=WD_ALIGN_PARAGRAPH.LEFT):
    p = doc.add_paragraph()
    tight(p, align=align, before=before, after=after, spacing=1.15)
    set_run(p.add_run(), text, size, bold=bold, color=color, font=FONT_CN)
    return p


def add_body(doc, text, size=11, color=DARK, before=2, after=2, align=WD_ALIGN_PARAGRAPH.LEFT,
             bold=False, spacing=1.5):
    p = doc.add_paragraph()
    tight(p, align=align, before=before, after=after, spacing=spacing)
    set_run(p.add_run(), text, size, bold=bold, color=color, font=FONT_CN)
    return p


def add_spacer(doc, pt=6):
    p = doc.add_paragraph()
    tight(p, spacing=1.0, before=0, after=0)
    set_run(p.add_run(), '', pt, font=FONT_CN)
    return p


# ----------------------------------------------------------------------
# 主构建流程
# ----------------------------------------------------------------------
def setup_page(doc):
    s = doc.sections[0]
    s.page_width = Cm(21.0)
    s.page_height = Cm(29.7)
    s.top_margin = Cm(1.5)
    s.bottom_margin = Cm(1.6)
    s.left_margin = Cm(1.5)
    s.right_margin = Cm(1.5)
    s.header_distance = Cm(0.8)
    s.footer_distance = Cm(0.8)
    # 页脚页码
    footer = s.footer
    p = footer.paragraphs[0]
    tight(p, align=WD_ALIGN_PARAGRAPH.CENTER, spacing=1.0)
    set_run(p.add_run(), '一年级数独题库　·　第 ', 9, color=MUTED, font=FONT_CN)
    fld = OxmlElement('w:fldSimple')
    fld.set(qn('w:instr'), 'PAGE')
    r = OxmlElement('w:r')
    rPr = OxmlElement('w:rPr')
    sz = OxmlElement('w:sz'); sz.set(qn('w:val'), '18'); rPr.append(sz)
    r.append(rPr)
    fld.append(r)
    p._p.append(fld)
    set_run(p.add_run(), ' 页', 9, color=MUTED, font=FONT_CN)


def add_cover(doc):
    for _ in range(3):
        add_spacer(doc, 16)
    add_band(doc, '一年级数独题库', size=32, before=0, after=8, align=WD_ALIGN_PARAGRAPH.CENTER)
    add_band(doc, '从零开始 · 4×4 → 6×6 → 9×9', size=15, color=MUTED, before=0, after=26,
             bold=False, align=WD_ALIGN_PARAGRAPH.CENTER)

    t = doc.add_table(rows=4, cols=2)
    fix_table(t, [6.2, 11.8])
    no_borders(t)
    info = [
        ('题目总数', '90 道（每个规格 30 道，分入门 / 进阶 / 挑战三组）'),
        ('配套教程', '《一年级数独入门教程》HTML 动画版，讲清规则和三种解题技巧'),
        ('答案位置', '本册最后面的「答案页」，每题都有编号对应'),
        ('打印建议', 'A4 单面。先只打印 4×4 入门那 10 道，做完再打印下一组'),
    ]
    for i, (k, v) in enumerate(info):
        row_height(t.rows[i], 1.2)
        ck = t.rows[i].cells[0]
        style_cell(ck, borders={'top': NONE, 'left': NONE, 'bottom': THIN, 'right': NONE}, margin=0.05)
        blank_cell_writer(ck, k, 12, ACCENT, bold=True, align=WD_ALIGN_PARAGRAPH.LEFT)
        cv = t.rows[i].cells[1]
        style_cell(cv, borders={'top': NONE, 'left': NONE, 'bottom': THIN, 'right': NONE}, margin=0.05)
        blank_cell_writer(cv, v, 11.5, DARK, align=WD_ALIGN_PARAGRAPH.LEFT)

    add_spacer(doc, 20)
    add_body(doc, '本册所有题目均由程序生成，并通过两道校验：① 答案唯一；② 只用「只缺一个」和'
                  '「排除法」两种最基础的技巧就能从头推到尾——不会出现推不动、只能靠猜的情况。',
             size=11, color=MUTED, align=WD_ALIGN_PARAGRAPH.CENTER, spacing=1.6)
    doc.add_page_break()


def add_howto(doc):
    add_band(doc, '怎么用这本练习册', size=20, before=0, after=10)
    add_body(doc, '三步开始：', size=13, bold=True, before=8, after=6)
    add_body(doc, '① 先看《一年级数独入门教程》的动画，把规则和三种技巧看懂（大约 15 分钟）；',
             size=11.5, after=4, spacing=1.6)
    add_body(doc, '② 回到这本书，从「4×4 入门」的第一组开始做，第一组最简单；', size=11.5, after=4, spacing=1.6)
    add_body(doc, '③ 做完一页再对答案，对了就往下做，累了就停。', size=11.5, after=10, spacing=1.6)

    add_body(doc, '三种解题技巧（教程里有动画讲解）', size=13, bold=True, before=8, after=6)
    t = doc.add_table(rows=4, cols=2)
    fix_table(t, [4.4, 13.6])
    no_borders(t)
    rows = [
        ('技巧名称', '怎么用'),
        ('① 只缺一个', '一排、一列或一间小房子里，如果只剩一个空格，那它一定填缺的那个数字。做题时先把所有这种地方找一遍。'),
        ('② 排除法', '一个格子里，把横排、竖列、小房子中出现过的数字都赶走，最后剩下的就是答案。三个方向都要看，别漏了小房子。'),
        ('③ 铅笔小数字', '拿不准时，用铅笔把「可能填的数字」小小地写进格子，确定后再擦掉重写。'),
    ]
    for i, (a, b) in enumerate(rows):
        row_height(t.rows[i], 1.5 if i else 0.75)
        ca, cb = t.rows[i].cells
        is_h = (i == 0)
        style_cell(ca, borders={'top': THICK if is_h else THIN, 'left': NONE,
                                'bottom': THICK if is_h else THIN, 'right': NONE}, margin=0.05)
        style_cell(cb, borders={'top': THICK if is_h else THIN, 'left': NONE,
                                'bottom': THICK if is_h else THIN, 'right': NONE}, margin=0.05)
        blank_cell_writer(ca, a, 12 if is_h else 11.5, ACCENT if is_h else DARK, bold=is_h,
                          align=WD_ALIGN_PARAGRAPH.LEFT)
        blank_cell_writer(cb, b, 12 if is_h else 11, ACCENT if is_h else DARK, bold=is_h,
                          align=WD_ALIGN_PARAGRAPH.LEFT)

    add_spacer(doc, 14)
    add_body(doc, '给爸爸妈妈的提示', size=13, bold=True, before=6, after=6)
    for line in [
        '· 每次 1–2 道题、10–15 分钟就够了，做完就停，保持兴趣比多做题更重要。',
        '· 孩子做完后，问一句「你是怎么知道这里填几的呀？」——把思路讲出来，才是真的会了。',
        '· 建议把答案页单独收起来，不要和孩子一起翻。做完再对。',
        '· 9×9 对一年级是超纲的，做到一半卡住完全正常，可以亲子一起做。',
    ]:
        add_body(doc, line, size=11, color=MUTED, after=3, spacing=1.6)


def add_part_cover(doc, key, count):
    """每个规格的分隔页（页首小标题 + 打印提示）"""
    cfg = LAYOUT[key]
    add_band(doc, cfg['title'] + '　·　共 %d 道' % count, size=21, before=0, after=8)
    add_body(doc, cfg['tip'], size=12, color=MUTED, after=10, spacing=1.6)
    add_body(doc, LEVEL_TITLE['easy'] + '（★☆☆）　' + LEVEL_TITLE['medium'] + '（★★☆）　'
             + LEVEL_TITLE['hard'] + '（★★★）', size=11.5, after=4, spacing=1.6)
    add_spacer(doc, 6)


def render_pages(doc, items, key, part_title, part_index):
    """按页渲染题目；题号在同一个规格内连续编号"""
    cfg = LAYOUT[key]
    n, br, bc = items[0]['size'], items[0]['br'], items[0]['bc']
    cols, rows = cfg['cols'], cfg['rows']
    cell_cm, font_pt = cfg['cell'], cfg['font']
    per_page = cols * rows
    base = part_index['n']

    pages = [items[i:i + per_page] for i in range(0, len(items), per_page)]
    total = len(pages)
    col_w = AVAIL_W / cols
    line_h = (AVAIL_H - 1.15) / rows

    for pi, page_items in enumerate(pages):
        add_page_header(doc, part_title, pi + 1, total)

        used_rows = math.ceil(len(page_items) / cols)
        t = doc.add_table(rows=used_rows, cols=cols)
        fix_table(t, [col_w] * cols)
        no_borders(t)

        for ri in range(used_rows):
            row = t.rows[ri]
            row_height(row, line_h)
            no_split(row)
            for ci in range(cols):
                cell = row.cells[ci]
                style_cell(cell, borders={'top': NONE, 'left': NONE, 'bottom': NONE, 'right': NONE},
                           margin=0.05, valign=WD_ALIGN_VERTICAL.TOP)
                idx = ri * cols + ci
                if idx >= len(page_items):
                    blank_cell_writer(cell, '', 8, MUTED)
                    tail_paragraph(cell)
                    continue
                item = page_items[idx]
                global_no = base + pi * per_page + idx
                puzzle_title_row(cell, '第 %d 题' % global_no, item['level_cn'],
                                 LEVEL_STAR[item['level']])
                draw_sudoku(cell, item['puzzle'], n, br, bc, cell_cm, font_pt)
                tail_paragraph(cell)

        if pi < total - 1:
            doc.add_page_break()

    part_index['n'] = base + len(items)


def add_answer_part(doc, data):
    doc.add_page_break()
    add_band(doc, '答案页', size=22, before=0, after=8)
    add_body(doc, '做完再对答案哦。答案和题号一一对应，题号格式是「规格-难度-序号」，'
                  '例如 4x4-E01 就是 4×4 入门组的第 1 题。',
             size=11, color=MUTED, after=12, spacing=1.6)

    plan = [
        ('4x4', 5, 6, 0.74, 8.5, 4.1),
        ('6x6', 4, 4, 0.66, 7.5, 5.6),
        ('9x9', 3, 4, 0.58, 6.8, 5.9),
    ]
    for key, cols, rows, cell_cm, title_pt, line_cm in plan:
        items = data[key]
        per_page = cols * rows
        pages = [items[i:i + per_page] for i in range(0, len(items), per_page)]
        for pi, page_items in enumerate(pages):
            add_page_header(doc, '答案 · ' + LAYOUT[key]['title'], pi + 1, len(pages))
            used_rows = math.ceil(len(page_items) / cols)
            t = doc.add_table(rows=used_rows, cols=cols)
            fix_table(t, [AVAIL_W / cols] * cols)
            no_borders(t)
            for ri in range(used_rows):
                row = t.rows[ri]
                row_height(row, (AVAIL_H - 1.15) / rows)
                no_split(row)
                for ci in range(cols):
                    cell = row.cells[ci]
                    style_cell(cell, borders={'top': NONE, 'left': NONE, 'bottom': NONE, 'right': NONE},
                               margin=0.05, valign=WD_ALIGN_VERTICAL.TOP)
                    idx = ri * cols + ci
                    if idx >= len(page_items):
                        blank_cell_writer(cell, '', 6, MUTED)
                        tail_paragraph(cell)
                        continue
                    item = page_items[idx]
                    p = cell.paragraphs[0]
                    tight(p, align=WD_ALIGN_PARAGRAPH.CENTER, spacing=1.0, after=2)
                    set_run(p.add_run(), item['id'], title_pt, bold=True, color=ACCENT, font=FONT_CN)
                    draw_sudoku(cell, item['solution'], item['size'], item['br'], item['bc'],
                                cell_cm, cell_cm * 12)
                    tail_paragraph(cell)
            if not (pi == len(pages) - 1 and key == plan[-1][0]):
                doc.add_page_break()


def build():
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, 'puzzles.json'), encoding='utf-8') as f:
        data = json.load(f)

    doc = Document()
    setup_page(doc)
    add_cover(doc)
    add_howto(doc)

    # 组装「块」：每个块都从新的一页开始
    blocks = []
    for key in ('4x4', '6x6', '9x9'):
        blocks.append(('part', key, None))
        for lv in ('easy', 'medium', 'hard'):
            blocks.append(('group', key, lv))

    part_index = {'n': 1}
    for i, (kind, key, lv) in enumerate(blocks):
        if i > 0:
            doc.add_page_break()
        if kind == 'part':
            add_part_cover(doc, key, len(data[key]))
            part_index['n'] = 1
        else:
            group = [p for p in data[key] if p['level'] == lv]
            add_band(doc, LEVEL_TITLE[lv] + '　（' + LEVEL_STAR[lv] + '）　共 %d 道' % len(group),
                     size=13, before=0, after=5)
            render_pages(doc, group, key, LAYOUT[key]['title'], part_index)

    add_answer_part(doc, data)

    out = os.path.join(os.path.dirname(here), '一年级数独题库（可打印）.docx')
    doc.save(out)
    print('已生成:', out)
    return out


if __name__ == '__main__':
    build()
