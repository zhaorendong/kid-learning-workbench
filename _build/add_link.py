# -*- coding: utf-8 -*-
"""把老师发的预习链接加进「学而思预习」模块的清单（modules/preview-1/links.js）。

为什么要这个脚本：
    预习链接是老师零散发在群里的，家长发过来 → 要出现在孩子端，
    路径是「改代码 → 跑脚本 → 部署」。手工编辑 links.js 容易漏掉
    generatedAt、或者把JS 语法改坏（页面直接白屏且不报错）。
    这里一次做完，并且顺手做体检（去重、格式校验）。

用法：
    # 加一条（最常用）
    python _build/add_link.py "https://xxx.app.workbuddy.link/" --title "第2课 · 认识图形"

    # 指定学科与备注
    python _build/add_link.py "https://…" --subject 数学 --note "老师说不认识的字先跳过"

    # 加完直接传上服务器（需要装了 paramiko 的 Python，见 docs/运维手册.md）
    python _build/add_link.py "https://…" --title "第2课" --upload

    # 只看会做什么，不动文件
    python _build/add_link.py "https://…" --title "第2课" --dry-run

    # 看看现在有哪些链接
    python _build/add_link.py --list

    # 删一条（按链接删，标题不用给）
    python _build/add_link.py --del "https://xxx.app.workbuddy.link/"

加完之后：
    - 不加 --upload：清单已更新，但**线上还是旧的** —— 必须再跑 deploy_pcc.py
    - 加了 --upload：清单 + 上传一次做完，iPad 刷新即可

★ 和家长端页面添加的区别：
    家长端加的只存在那台设备的浏览器里（本机添加），换个设备就没了；
    这个脚本写进的是代码清单（跟代码走），所有设备都能看到。
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LINKS_JS = os.path.join(ROOT, 'modules', 'preview-1', 'links.js')
LOG = os.path.join(HERE, 'add_link.log')
OUT = []

SUBJECTS = ['语文', '数学', '英语', '思维', '综合']


def log(*a):
    line = ' '.join(str(x) for x in a)
    OUT.append(line)
    print(line, flush=True)


def write_log():
    with io.open(LOG, 'w', encoding='utf-8') as f:
        f.write('\n'.join(OUT))


# --------------------------------------------------------------------------
# 读 / 写 links.js
# --------------------------------------------------------------------------
# links.js 里 window.XYB_LINKS = {...}; 的对象是**合法 JSON**
#（键名带双引号，和 videos.js 完全一致），所以能直接 json.loads / json.dumps。
#
# ⚠️ 踩过的坑：早先links.js 用的是 JS 字面量（键名不带引号：generatedAt: '...'），
#    于是想用正则把 JS 风格转成 JSON 喂给 json.loads —— 结果中文弯引号
#    （note 里老师原文常带"「」""）和各种转义字符把正则搞坏，解析直接报错。
#    结论：**保持 links.js 为合法 JSON**，读写都用标准库，不做格式转换。
BLOCK_RE = re.compile(r'(window\.XYB_LINKS\s*=\s*)(\{.*?\n\};)', re.S)


def read_links():
    if not os.path.isfile(LINKS_JS):
        return {'generatedAt': date.today().isoformat(), 'items': []}
    src = io.open(LINKS_JS, encoding='utf-8').read()
    m = BLOCK_RE.search(src)
    if not m:
        raise SystemExit('! links.js 结构不对（找不到 window.XYB_LINKS = {...};），'
                         '为避免覆盖人工改动，这里停下不做任何写入')
    body = m.group(2).rstrip().rstrip(';')
    try:
        return json.loads(body)
    except Exception as ex:
        raise SystemExit('! links.js 不是合法 JSON：%s\n'
                         '  （请检查是不是手工改坏了；为避免覆盖，这里停下不做任何写入）' % ex)


def write_links(data):
    """重写 links.js，保留文件头的说明注释。"""
    old = io.open(LINKS_JS, encoding='utf-8').read() if os.path.isfile(LINKS_JS) else ''
    m = BLOCK_RE.search(old)
    head = old[:m.start()] if m else (
        '/* 预习链接清单 —— 由 _build/add_link.py 生成，请勿手改 */\n'
        'window.XYB_LINKS = {\n  "generatedAt": "",\n  "items": []\n};\n'
    )
    body = json.dumps(data, ensure_ascii=False, indent=2)
    out = head + 'window.XYB_LINKS = ' + body + ';\n'
    with io.open(LINKS_JS, 'w', encoding='utf-8', newline='\n') as f:
        f.write(out)


# --------------------------------------------------------------------------
# URL 归一化
# --------------------------------------------------------------------------
# ⚠️ 必须与 assets/core.js 里的 pvKey()/A.preview.key() **逐行等价** ——
#    脚本在这里判"重复"，页面在那里判"同一条"，两边不一致就会出现
#    "明明加过却显示两条"或者"删了却删不掉"。
#    顺序：去协议 → 去 #片段 → 去 ?查询串 → 去末尾斜杠 → 转小写
#
#    ⚠️ **必须先剥查询串再去末尾斜杠**（这个顺序踩过坑）：
#    老师发来的链接几乎都带分享参数（?from=groupmessage），
#    如果先 `/+$`再去 `?`，那么
#        https://x.com/y/?from=chat→x.com/y/     ← 尾斜杠留着
#        https://x.com/y/            → x.com/y
#    两条明明是同一个页面，却算出两个不同的 key → 清单里出现两张一样的卡片，
#    页面还删不掉其中一条。先剥查询串，两边就都是 x.com/y。
#
#    为什么连查询串一起剥：同一个页面会因分享参数不同被当成不同链接显示两次。
#    反过来，如果某个站**必须**靠查询串区分不同内容（?id=1 / ?id=2），
#    剥掉就会误判成同一条 —— 真遇到这种站，在标题里写清区别，
#    或告诉我，我给 url_key() 加白名单。
def url_key(u):
    s = (u or '').strip()
    s = re.sub(r'^https?://', '', s, flags=re.I)
    s = s.split('#')[0]
    q = s.find('?')
    if q > -1:
        s = s[:q]
    s = re.sub(r'/+$', '', s)
    return s.lower()


def check_url(u):
    """返回 (ok, 原因)。刻意只拦真正打不开的情况，不做过度限制。"""
    if not u:
        return False, '链接是空的'
    if not re.match(r'^https?://', u, re.I):
        return False, '要以 http:// 或 https:// 开头（可能连"【预习链接】"一起复制了）'
    if re.search(r'\s', u):
        return False, '链接里有空格，多半复制时带上了别的文字，请只复制链接本身'
    if re.search(r'^[a-z]+://[^/]*\s', u, re.I):
        return False, '域名里有空格，检查一下是否多复制了标点'
    return True, ''


# --------------------------------------------------------------------------
# 命令
# --------------------------------------------------------------------------
def do_add(args):
    url = args.url.strip()
    ok, why = check_url(url)
    if not ok:
        log('× %s' % why)
        return 1

    data = read_links()
    k = url_key(url)
    items = data.setdefault('items', [])

    dup = None
    for it in items:
        if url_key(it.get('url', '')) == k:
            dup = it
            break

    if dup and not args.force:
        log('× 清单里已经有这条链接了（按去掉末尾 / 之后的网址比对）：')
        log('    标题：%s' % dup.get('title', ''))
        log('    链接：%s' % dup.get('url', ''))
        log('  想改标题/备注就加 --force（会覆盖同一条，不会新增第二条）')
        return 1

    # 字段优先级：命令行显式给的 > 已有那条的 > 默认值。
    # 刻意分三步而不是一个三元表达式链 —— 那样 `or`/`and` 的优先级很容易看错。
    entry = {
        'url': url,
        'title': args.title or (dup.get('title') if dup else '') or '预习内容',
        'subject': args.subject or (dup.get('subject') if dup else '') or '综合',
        'note': args.note if args.note is not None else (dup.get('note', '') if dup else ''),
        'addedAt': date.today().isoformat() if not dup else dup.get('addedAt', ''),
    }

    if dup:
        items[items.index(dup)] = entry
        log('→ 已更新同一条链接（--force）：%s' % entry['title'])
    else:
        items.insert(0, entry)          # 新的放最前：页面按时间倒序
        log('→ 已加入：%s' % entry['title'])

    log('  链接：%s' % entry['url'])
    log('  学科：%s%s' % (entry['subject'],
                         '' if entry['subject'] in SUBJECTS else '（不在标准列表，页面用默认配色）'))
    if entry['note']:
        log('  备注：%s' % entry['note'])

    if args.dry_run:
        log('')
        log('--dry-run：清单没有真的写入')
        return 0

    data['generatedAt'] = date.today().isoformat()
    write_links(data)
    log('✓ 已写入 %s' % os.path.relpath(LINKS_JS, ROOT).replace('\\', '/'))
    log('  清单现有 %d 条' % len(items))
    finish(args)
    return 0


def do_del(args):
    data = read_links()
    k = url_key(args.del_url)
    items = data.get('items', [])
    hit = [it for it in items if url_key(it.get('url', '')) == k]
    if not hit:
        log('× 清单里没有这条链接')
        log('  先看看现在有哪些：python _build/add_link.py --list')
        return 1
    if len(hit) > 1:
        log('! 清单里有 %d 条归一化后相同的链接，本次全部删除：' % len(hit))
    if args.dry_run:
        for h in hit:
            log('  将删除：%s%s' % (h.get('title', ''), '（--dry-run，没真删）' % ''))
        return 0
    items = [it for it in items if url_key(it.get('url', '')) != k]
    data['items'] = items
    data['generatedAt'] = date.today().isoformat()
    write_links(data)
    log('✓ 已删除 %d 条，清单现有 %d 条' % (len(hit), len(items)))
    log('  注意：已经加过这条链接的浏览器可能还留着本地记录，'
        '在家长端「学而思预习链接」里删一次即可清掉。')
    finish(args)
    return 0


def do_list(args):
    data = read_links()
    items = data.get('items', [])
    log('清单：%s' % os.path.relpath(LINKS_JS, ROOT).replace('\\', '/'))
    log('生成时间：%s' % data.get('generatedAt', '?'))
    log('共 %d 条' % len(items))
    log('')
    for i, it in enumerate(items, 1):
        log('%2d. [%s] %s' % (i, it.get('subject', '综合'), it.get('title', '')))
        log('    %s' % it.get('url', ''))
        if it.get('note'):
            log('    备注：%s' % it['note'])
        log('    加入：%s' % it.get('addedAt', '?'))
    if not items:
        log('（还没有链接）')
    # 顺手体检：归一化后重复的、格式可疑的
    seen, dup = {}, []
    for it in items:
        k = url_key(it.get('url', ''))
        if k in seen:
            dup.append(it.get('url', ''))
        seen[k] = 1
    if dup:
        log('')
        log('⚠️ 有 %d 条链接归一化后重复（页面只显示一条，另一条等于白加）：' % len(dup))
        for u in dup:
            log('    %s' % u)
    bad = [it.get('url', '') for it in items if not check_url(it.get('url', ''))[0]]
    if bad:
        log('')
        log('⚠️ 有 %d 条链接格式可疑：' % len(bad))
        for u in bad:
            log('    %s' % u)
    return 0


def finish(args):
    """按 --upload 决定是否直接部署。"""
    if args.upload:
        try:
            import paramiko        # noqa: F401
        except ImportError:
            log('')
            log('! --upload 需要 paramiko。请换用装了它的 Python 跑，例如：')
            log('  ...\\python\\envs\\default\\Scripts\\python.exe _build\\add_link.py ...')
            log('  （清单已经改好了，单独跑 python _build\\deploy_pcc.py 也能上线）')
            return
        log('')
        log('=== 上传到服务器 ===')
        r = subprocess.run([sys.executable, os.path.join(HERE, 'deploy_pcc.py')], cwd=ROOT)
        if r.returncode != 0:
            log('! 上传没成功（exit=%d），看 _build/deploy.log' % r.returncode)
        return
    log('')
    log('下一步（要让孩子在 iPad 上看到，必须上传）：')
    log('  python _build\\deploy_pcc.py')
    log('  （或者下次加链接时直接加 --upload 参数）')


def main():
    ap = argparse.ArgumentParser(
        description='把老师发的预习链接加进「学而思预习」模块',
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('url', nargs='?', help='要加入的预习链接')
    ap.add_argument('--title', help='标题，如"第2课 · 认识图形"')
    ap.add_argument('--subject', choices=SUBJECTS, help='学科（默认"综合"）')
    ap.add_argument('--note', help='备注（会显示在标题下面）')
    ap.add_argument('--force', action='store_true', help='已存在时覆盖同一条，而不是报错')
    ap.add_argument('--upload', action='store_true', help='改完直接上传到服务器')
    ap.add_argument('--dry-run', action='store_true', help='只显示会做什么，不写文件')
    ap.add_argument('--list', action='store_true', help='列出清单现状并体检')
    ap.add_argument('--del', dest='del_url', help='按链接删掉一条')
    args = ap.parse_args()

    if not os.path.isfile(LINKS_JS):
        log('! 找不到 %s —— 模块preview-1 可能还没建' % LINKS_JS)
        return 1

    if args.list:
        rc = do_list(args)
    elif args.del_url:
        rc = do_del(args)
    elif args.url:
        rc = do_add(args)
    else:
        ap.print_help()
        rc = 1
    write_log()
    return rc


if __name__ == '__main__':
    sys.exit(main())