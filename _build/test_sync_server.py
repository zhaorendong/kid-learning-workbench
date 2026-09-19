# -*- coding: utf-8 -*-
"""服务端 API 测试：在本机起一个临时实例，把关键行为全部验一遍。
   不依赖 PC-C，可随时重跑。输出 _build/test_server.log"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, 'server', 'server.py')
PORT = 18199
BASE = 'http://127.0.0.1:%d' % PORT
KEY = 'test-1234'
KEYH = __import__('hashlib').sha256(('xyb::' + KEY).encode()).hexdigest()

OUT = []
PASS = 0
FAIL = 0


def log(s=''):
    OUT.append(str(s))


def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        log('  ✓ %s' % name)
    else:
        FAIL += 1
        log('  ✗ %s   %s' % (name, detail))


def req(path, method='GET', body=None, key=None):
    url = BASE + path
    data = json.dumps(body).encode('utf-8') if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header('Content-Type', 'application/json')
    if key:
        r.add_header('Authorization', 'Bearer ' + key)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(r, timeout=15) as resp:
            return resp.status, json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, {}


def ev(eid, t, ts, **kw):
    d = {'id': eid, 't': t, 'ts': ts, 'd': 'devA'}
    d.update(kw)
    return d


def main():
    tmp = tempfile.mkdtemp(prefix='xyb-srv-')
    log('临时数据目录：%s' % tmp)
    proc = subprocess.Popen(
        [sys.executable, '-u', SERVER, '--port', str(PORT), '--data', tmp],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        # 等服务起来
        up = False
        for _ in range(60):
            time.sleep(0.25)
            try:
                st, b = req('/api/ping')
                if st == 200 and b.get('ok'):
                    up = True
                    break
            except Exception:
                pass
        log('\n===== 0. 启动 =====')
        check('服务已启动 /api/ping', up)
        if not up:
            return
        st, b = req('/api/ping')
        check('ping 不需要鉴权', st == 200 and b.get('ok'))
        check('初始 keySet=false', b.get('keySet') is False, str(b))

        log('\n===== 1. 家庭口令 =====')
        st, b = req('/api/events?since=0')
        check('未设口令时拒绝裸奔读数据', st == 401 and b.get('code') == 'SETUP', str(b))
        st, b = req('/api/info')
        check('未设口令时拒绝访问 info', st == 401 and b.get('code') == 'SETUP', str(b))
        st, b = req('/api/setkey', 'POST', {'key': KEY})
        check('设置口令成功', st == 200 and b.get('set'), str(b))
        st, b = req('/api/setkey', 'POST', {'key': 'x'})
        check('口令太短被拒', st == 400, str(b))
        st, b = req('/api/info')
        check('无口令访问被拒 401', st == 401 and b.get('code') == 'AUTH', str(b))
        st, b = req('/api/info', key='wrong')
        check('错误口令被拒 401', st == 401, str(b))
        st, b = req('/api/info', key=KEYH)
        check('正确口令可访问', st == 200 and b.get('ok'), str(b))
        st, b = req('/api/events?since=0', key=KEYH)
        check('日志文件还不存在时返回空列表（不报错）',
              st == 200 and b.get('count') == 0, str(b))

        log('\n===== 2. 推送与 rev 分配 =====')
        st, b = req('/api/sync', 'POST', {'device': 'devA', 'gen': 1, 'since': 0,
                                          'events': [ev('devA:1', 'open', 1000),
                                                     ev('devA:2', 'answer', 2000, mid='math')]},
                    key=KEYH)
        check('推送 2 条成功', st == 200 and b.get('accepted') == 2, str(b))
        check('rev 递增到 2', b.get('rev') == 2, str(b))
        check('返回全部 2 条事件', b.get('count') == 2, str(b))
        check('事件带 rev/gen/st', all(('rev' in e and 'gen' in e and 'st' in e) for e in b['events']))

        log('\n===== 3. 重传幂等（网络抖动场景）=====')
        st, b = req('/api/sync', 'POST', {'device': 'devA', 'gen': 1, 'since': 2,
                                          'events': [ev('devA:1', 'open', 1000),
                                                     ev('devA:2', 'answer', 2000, mid='math')]},
                    key=KEYH)
        check('重复事件被去重', b.get('duplicated') == 2 and b.get('accepted') == 0, str(b))
        check('rev 未增长', b.get('rev') == 2, str(b))
        # 重复件也要回报 id，否则客户端永远清不掉本地待推送队列（会无限重传）
        check('ackIds 把重复件也回报了',
              sorted(b.get('ackIds') or []) == ['devA:1', 'devA:2'], str(b))

        log('\n===== 4. 增量拉取 =====')
        st, b = req('/api/sync', 'POST', {'device': 'devB', 'gen': 1, 'since': 0,
                                          'events': [ev('devB:1', 'finish', 3000, mid='pinyin')]},
                    key=KEYH)
        check('另一端首次同步拿到全部 3 条', b.get('count') == 3, str(b))
        st, b = req('/api/sync', 'POST', {'device': 'devB', 'gen': 1, 'since': 3, 'events': []},
                    key=KEYH)
        check('已是最新时返回 0 条', b.get('count') == 0 and b.get('rev') == 3, str(b))
        st, b = req('/api/events?since=1&gen=1', key=KEYH)
        check('GET /api/events 增量正确', b.get('count') == 2, str(b))
        st, info = req('/api/info', key=KEYH)
        check('设备列表记录了两台', len(info.get('devices') or {}) == 2, str(info.get('devices')))

        log('\n===== 5. 追加顺序稳定（多端收敛的前提）=====')
        st, b = req('/api/events?since=0&gen=1', key=KEYH)
        revs = [e['rev'] for e in b['events']]
        check('rev 严格递增', revs == sorted(revs) and len(set(revs)) == len(revs), str(revs))
        check('rev 从 1 开始连续', revs == list(range(1, len(revs) + 1)), str(revs))

        log('\n===== 6. 版本快照与回滚 =====')
        st, b = req('/api/versions', key=KEYH)
        check('回滚前无快照', len(b.get('versions') or []) == 0, str(b))
        st, b = req('/api/rollback', 'POST', {'rev': 2}, key=KEYH)
        check('回滚成功', st == 200 and b.get('ok'), str(b))
        check('回滚后 rev=2', b.get('rev') == 2, str(b))
        check('gen 已递增（触发全网重同步）', b.get('gen') == 2, str(b))
        check('回滚前留了快照', bool(b.get('snapshot')), str(b))
        st, b = req('/api/versions', key=KEYH)
        check('快照列表有记录', len(b.get('versions') or []) == 1, str(b))
        st, b = req('/api/events?since=0&gen=1', key=KEYH)
        check('gen 不一致时强制全量返回', b.get('count') == 2, str(b))

        log('\n===== 7. 回滚后继续写入 =====')
        st, b = req('/api/sync', 'POST', {'device': 'devA', 'gen': 2, 'since': 2,
                                          'events': [ev('devA:9', 'answer', 4000, mid='math')]},
                    key=KEYH)
        check('回滚后新事件 rev=3', b.get('rev') == 3 and b.get('accepted') == 1, str(b))

        log('\n===== 8. 重置 =====')
        st, b = req('/api/reset', 'POST', {}, key=KEYH)
        check('缺少 confirm 被拒', st == 400, str(b))
        st, b = req('/api/reset', 'POST', {'confirm': True}, key=KEYH)
        check('重置成功 rev=0', st == 200 and b.get('rev') == 0, str(b))
        check('重置后 gen=3', b.get('gen') == 3, str(b))
        st, b = req('/api/events?since=0&gen=3', key=KEYH)
        check('重置后事件为空', b.get('count') == 0, str(b))
        st, b = req('/api/versions', key=KEYH)
        check('重置也留了快照', len(b.get('versions') or []) >= 2, str(b))

        log('\n===== 9. 边界 =====')
        st, b = req('/api/sync', 'POST', {'device': 'devA', 'gen': 3, 'since': 0, 'events': 'nope'},
                    key=KEYH)
        check('events 非数组被拒', st == 400, str(b))
        st, b = req('/api/sync', 'POST', {'device': 'devA', 'gen': 3, 'since': 0,
                                          'events': [{'no_id': 1}, {'id': 'ok:1', 't': 'open', 'ts': 1}]},
                    key=KEYH)
        check('缺 id 的事件被跳过，其余照收', b.get('accepted') == 1, str(b))
        st, b = req('/api/nope', key=KEYH)
        check('未知接口 404', st == 404, str(b))

        log('\n===== 10. 重启后数据仍在（持久化）=====')
        proc.terminate()
        proc.wait(timeout=10)
        proc = subprocess.Popen(
            [sys.executable, '-u', SERVER, '--port', str(PORT), '--data', tmp],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        time.sleep(1.5)
        st, b = req('/api/events?since=0&gen=3', key=KEYH)
        check('重启后事件仍在', b.get('count') == 1, str(b))
        check('重启后 rev 保持', b.get('rev') == 1, str(b))
        st, b = req('/api/ping')
        check('重启后口令仍然有效', b.get('keySet') is True, str(b))

        log('\n===== 11. 落盘产物 =====')
        for f in sorted(os.listdir(tmp)):
            fp = os.path.join(tmp, f)
            if os.path.isdir(fp):
                log('  [dir] %s  (%d 个文件)' % (f, len(os.listdir(fp))))
            else:
                log('  %-16s %8d B' % (f, os.path.getsize(fp)))
        check('events.jsonl 存在', os.path.exists(os.path.join(tmp, 'events.jsonl')))
        check('versions 目录有快照', len(os.listdir(os.path.join(tmp, 'versions'))) >= 2)

    finally:
        try:
            proc.terminate()
            proc.wait(timeout=10)
        except Exception:
            pass
        shutil.rmtree(tmp, ignore_errors=True)

    log('\n' + '=' * 50)
    log('通过 %d / %d' % (PASS, PASS + FAIL))
    log('全部通过 ✅' if FAIL == 0 else '有 %d 项失败 ❌' % FAIL)
    open(os.path.join(HERE, 'test_server.log'), 'w', encoding='utf-8').write('\n'.join(OUT))
    print('done')


if __name__ == '__main__':
    main()
