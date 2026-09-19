# -*- coding: utf-8 -*-
"""对 PC-C 上真实运行的数据服务做端到端验证。
   脚本可重复执行：开始先清场 → 跑验证 → 结束再清场，
   最终把数据与口令都留成全新状态，由用户在家长端自己设置口令。
   输出 _build/e2e_server.log"""
import hashlib
import json
import os
import time
import traceback
import urllib.error
import urllib.request

import site_config
from site_config import CFG

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BASE = 'http://%s:%d' % (CFG['host'], int(CFG['api_port']))
TMPKEY = 'e2e-temp-9f3a'
KEYH = hashlib.sha256(('xyb::' + TMPKEY).encode()).hexdigest()
DATA_DIR = r'C:\workspace\xiaoyuebing-data'
TASK = 'XYBDataServer'

OUT = []
P = F = 0


def log(s=''):
    OUT.append(str(s))


def check(name, cond, detail=''):
    global P, F
    if cond:
        P += 1
        log('  ✓ %s' % name)
    else:
        F += 1
        log('  ✗ %s   %s' % (name, detail))


def req(path, method='GET', body=None, key=None, timeout=15):
    url = BASE + path
    data = json.dumps(body).encode('utf-8') if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header('Content-Type', 'application/json')
    if key:
        r.add_header('Authorization', 'Bearer ' + key)
    op = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with op.open(r, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {'_error': str(e)}


cli = site_config.ssh_connect()


def run(cmd, timeout=120):
    _, so, se = cli.exec_command(cmd, timeout=timeout)
    return so.read().decode('gbk', 'replace'), se.read().decode('gbk', 'replace')


def wipe(label):
    """停服务 → 删数据 → 清口令 → 重启，回到全新状态。"""
    log('  [%s] 停服务并清空数据 …' % label)
    run('schtasks /end /tn ' + TASK)
    time.sleep(1.5)
    for f in ('events.jsonl', 'meta.json', 'server.log'):
        run('del /f /q "%s\\%s" 2>nul' % (DATA_DIR, f))
    run('del /f /q "%s\\versions\\*.jsonl" 2>nul' % DATA_DIR)
    sftp = cli.open_sftp()
    with sftp.open(DATA_DIR + r'\config.json', 'w') as f:
        f.write(json.dumps({'keyHash': '', 'createdAt': time.strftime('%Y-%m-%d %H:%M:%S')},
                           ensure_ascii=False, indent=2))
    sftp.close()
    run('schtasks /run /tn ' + TASK)
    for _ in range(20):
        time.sleep(0.6)
        st, b = req('/api/ping')
        if st == 200 and b.get('ok') and b.get('rev') == 0:
            return True
    return False


def ev(eid, t, ts, d='e2e', **kw):
    o = {'id': eid, 't': t, 'ts': ts, 'd': d}
    o.update(kw)
    return o


def main():
    log('===== 0. 清场（保证可重复执行）=====')
    check('清场完成，服务 rev=0', wipe('start'))

    log('\n===== 1. 服务可达 =====')
    st, b = req('/api/ping')
    check('GET /api/ping 200', st == 200 and b.get('ok'), str(b))
    check('版本号存在', bool(b.get('version')), str(b))

    log('\n===== 2. 先设一个临时口令 =====')
    st, b = req('/api/setkey', 'POST', {'key': TMPKEY})
    check('设置临时口令', st == 200 and b.get('set'), str(b))
    st, b = req('/api/events?since=0', key='wrong-key')
    check('错误口令被拒', st == 401, str(b))
    st, b = req('/api/events?since=0', key=KEYH)
    check('正确口令可读', st == 200, str(b))

    log('\n===== 3. 两个"设备"交替写入（模拟 iPad + 电脑）=====')
    st, b = req('/api/sync', 'POST',
                {'device': 'e2e-ipad', 'gen': 1, 'since': 0,
                 'events': [ev('ipad:1', 'open', 1000),
                            ev('ipad:2', 'answer', 2000, mid='math-calc', correct=True)]},
                key=KEYH)
    check('iPad 提交 2 条', b.get('accepted') == 2 and b.get('rev') == 2, str(b))
    st, b = req('/api/sync', 'POST',
                {'device': 'e2e-pc', 'gen': 1, 'since': 0,
                 'events': [ev('pc:1', 'finish', 3000, mid='pinyin-1', stars=3)]},
                key=KEYH)
    check('电脑提交 1 条且拿到全部 3 条', b.get('accepted') == 1 and b.get('count') == 3, str(b))
    st, b = req('/api/sync', 'POST', {'device': 'e2e-pc', 'gen': 1, 'since': 3, 'events': []},
                key=KEYH)
    check('无新数据时返回 0 条', b.get('count') == 0, str(b))

    log('\n===== 4. 重复提交幂等（掉线重传）=====')
    st, b = req('/api/sync', 'POST',
                {'device': 'e2e-ipad', 'gen': 1, 'since': 2,
                 'events': [ev('ipad:1', 'open', 1000),
                            ev('ipad:2', 'answer', 2000, mid='math-calc', correct=True)]},
                key=KEYH)
    check('重复 2 条全部去重', b.get('duplicated') == 2 and b.get('accepted') == 0, str(b))

    log('\n===== 5. 落盘与 meta =====')
    o, _ = run('type "%s\\meta.json"' % DATA_DIR)
    meta = {}
    try:
        meta = json.loads(o.strip())
    except Exception:
        pass
    check('meta.json 记录了 rev=3', meta.get('rev') == 3, o.strip()[:200])
    check('meta.json 记录了两台设备', len(meta.get('devices') or {}) == 2, str(meta.get('devices')))
    o, _ = run('for %%I in ("%s\\events.jsonl") do @echo %%~zI' % DATA_DIR)
    size = (o.strip() or '0')
    check('events.jsonl 已写入内容', size not in ('', '0'), 'size=' + size)

    log('\n===== 6. 回滚 =====')
    st, b = req('/api/rollback', 'POST', {'rev': 2}, key=KEYH)
    check('回滚到 rev=2 成功', st == 200 and b.get('rev') == 2, str(b))
    check('gen 递增触发全网重同步', b.get('gen') == 2, str(b))
    st, b = req('/api/versions', key=KEYH)
    check('快照已生成', len(b.get('versions') or []) == 1, str(b))

    log('\n===== 7. 清场并确认最终状态 =====')
    check('清场完成', wipe('end'))
    st, b = req('/api/ping')
    check('gen 回到 1', b.get('gen') == 1, str(b))
    check('rev 回到 0', b.get('rev') == 0, str(b))
    check('口令已清空（等你在家长端设置）', b.get('keySet') is False, str(b))
    st, b = req('/api/events?since=0', key=KEYH)
    check('旧口令已失效', st == 401, str(b))
    st, b = req('/api/events?since=0')
    check('未设口令时拒绝读数据', st == 401 and b.get('code') == 'SETUP', str(b))

    log('\n===== 8. 最终落地状态 =====')
    o, _ = run('dir /b "%s"' % DATA_DIR)
    log('  数据目录: %s' % ' | '.join(x.strip() for x in o.strip().splitlines()))
    o, _ = run('schtasks /query /tn %s /v /fo LIST' % TASK)
    for line in o.splitlines():
        s = line.strip()
        if s.startswith(('模式', '计划类型', '计划任务状态', '运行方式')):
            log('  %s' % s)
    o, _ = run('netstat -ano | findstr LISTENING | findstr :8100')
    log('  监听: %s' % o.strip())


try:
    main()
except Exception:
    OUT.append('\n!!! 脚本异常 !!!\n' + traceback.format_exc())
    F += 1
finally:
    try:
        cli.close()
    except Exception:
        pass

log('\n' + '=' * 50)
log('通过 %d / %d' % (P, P + F))
log('全部通过 ✅' if F == 0 else '有 %d 项失败 ❌' % F)
open(os.path.join(ROOT, '_build', 'e2e_server.log'), 'w', encoding='utf-8').write('\n'.join(OUT))
print('done')
