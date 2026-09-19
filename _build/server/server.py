# -*- coding: utf-8 -*-
"""
小悦饼学习工作台 · 数据服务
======================================================================

设计要点（为什么这么做）
----------------------------------------------------------------------
服务器**不做合并**，只做一件事：把客户端产生的事件**追加**到事件日志里，
并给每条事件分配一个全局递增的 rev。

  同步真相 = 事件日志（append-only）
  派生状态 = 客户端把事件按 rev 顺序归约（reduce）出来

这样带来三个关键好处：

1. **多端天然收敛**：所有设备拿到的是同一份事件集合 + 同一个顺序，
   归约出来的状态必然一致。不需要写"合并算法"，也就不会因为合并写错而丢数据。
2. **重传安全**：事件带全局唯一 id（`设备id:序号`），服务器按 id 去重，
   网络抖动重复提交不会重复计数。
3. **回滚天然可行**：把日志截断到某个 rev 就是一个历史版本，不需要额外的反向操作。

数据文件（默认 C:\\workspace\\xiaoyuebing-data）
  config.json    家庭口令的哈希（不存明文）
  meta.json      gen / rev / 设备列表 / 最后写入时间
  events.jsonl   事件日志，一行一条
  versions/      每次破坏性操作前的快照

启动
  python server.py --port 8100 --data "C:\\workspace\\xiaoyuebing-data"

只用 Python 标准库，不需要装任何第三方包。
======================================================================
"""
import argparse
import hashlib
import hmac
import json
import os
import sys
import threading
import time
import traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = '1.0.0'
APP = '小悦饼学习工作台'
MAX_BODY = 16 * 1024 * 1024          # 单次请求体上限
MAX_EVENTS_PER_PUSH = 20000          # 单次可提交事件数上限
KEEP_VERSIONS = 60                   # 最多保留多少份快照

LOCK = threading.RLock()             # 日志与 meta 的写入锁（单进程多线程）
STATE = {
    'dir': '',
    'gen': 1,
    'rev': 0,
    'ids': set(),                    # 已接受事件 id（去重用）
    'devices': {},
    'createdAt': '',
    'updatedAt': '',
}


# ----------------------------------------------------------------------
# 文件路径与小工具
# ----------------------------------------------------------------------
def p(*a):
    return os.path.join(STATE['dir'], *a)


def now_iso():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def stamp():
    return datetime.now().strftime('%Y%m%d-%H%M%S')


def write_json_atomic(path, obj):
    """先写临时文件再替换，避免掉电/崩溃留下半个文件。"""
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def read_json(path, dflt=None):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return dflt


def log(msg):
    line = '[%s] %s\n' % (now_iso(), msg)
    sys.stdout.write(line)
    sys.stdout.flush()
    try:
        with open(p('server.log'), 'a', encoding='utf-8') as f:
            f.write(line)
    except Exception:
        pass


def key_hash(passphrase):
    return hashlib.sha256(('xyb::' + str(passphrase)).encode('utf-8')).hexdigest()


# ----------------------------------------------------------------------
# 事件日志
# ----------------------------------------------------------------------
def load_log():
    """启动时把日志读进内存（事件量在家庭场景下很小）。返回事件列表。"""
    path = p('events.jsonl')
    events = []
    if not os.path.exists(path):
        return events
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except Exception:
                log('!! 跳过无法解析的日志行（%d 字节）' % len(line))
    return events


def boot(data_dir):
    STATE['dir'] = data_dir
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(p('versions'), exist_ok=True)

    cfg = read_json(p('config.json'))
    if not cfg:
        cfg = {'keyHash': '', 'createdAt': now_iso()}
        write_json_atomic(p('config.json'), cfg)

    meta = read_json(p('meta.json')) or {}
    STATE['gen'] = int(meta.get('gen') or 1)
    STATE['rev'] = int(meta.get('rev') or 0)
    STATE['devices'] = meta.get('devices') or {}
    STATE['createdAt'] = meta.get('createdAt') or now_iso()
    STATE['updatedAt'] = meta.get('updatedAt') or ''

    events = load_log()
    ids = set()
    max_rev = 0
    for ev in events:
        eid = ev.get('id')
        if eid:
            ids.add(eid)
        r = ev.get('rev')
        if isinstance(r, int) and r > max_rev:
            max_rev = r
    STATE['ids'] = ids
    if max_rev > STATE['rev']:
        STATE['rev'] = max_rev
    log('%s v%s 启动：数据目录 %s' % (APP, VERSION, data_dir))
    log('  已加载事件 %d 条，rev=%d，gen=%d，设备 %d 台'
        % (len(events), STATE['rev'], STATE['gen'], len(STATE['devices'])))
    return events


def save_meta():
    write_json_atomic(p('meta.json'), {
        'gen': STATE['gen'], 'rev': STATE['rev'], 'devices': STATE['devices'],
        'createdAt': STATE['createdAt'], 'updatedAt': STATE['updatedAt'],
        'app': APP, 'version': VERSION,
    })


def append_events(new_events, device):
    """给事件分配 rev 并追加到日志。

    返回 (accepted, dup, ack_ids)：
      ack_ids = 服务端**确定已经持有**的事件 id（本次新收的 + 本来就有的重复件）。
    客户端必须用它来清空本地待推送队列 —— 只按"本次返回的新事件"清队列是不够的：
    「服务端已落盘、但响应在回程丢掉了」这类事件，下次重传会被判为重复件、
    又不出现在返回的新事件里，于是永远清不掉，队列越积越多。
    """
    accepted, dup = 0, 0
    ack_ids = []
    lines = []
    for raw in new_events:
        if not isinstance(raw, dict):
            continue
        eid = raw.get('id')
        if not eid or not isinstance(eid, str):
            continue
        if eid in STATE['ids']:
            dup += 1
            ack_ids.append(eid)       # 已经收过了 → 也告诉客户端"这条可以清了"
            continue
        STATE['rev'] += 1
        ev = dict(raw)
        ev['id'] = eid
        ev['rev'] = STATE['rev']
        ev['gen'] = STATE['gen']
        ev['st'] = now_iso()
        ev['d'] = raw.get('d') or device or 'unknown'
        STATE['ids'].add(eid)
        lines.append(json.dumps(ev, ensure_ascii=False))
        accepted += 1
        ack_ids.append(eid)

    if lines:
        with open(p('events.jsonl'), 'a', encoding='utf-8') as f:
            f.write('\n'.join(lines) + '\n')
            f.flush()
            os.fsync(f.fileno())      # 数据安全是这个服务的全部意义，落盘要硬
        d = STATE['devices'].get(device) or {'first': now_iso(), 'count': 0}
        d['count'] = int(d.get('count') or 0) + accepted
        d['last'] = now_iso()
        STATE['devices'][device] = d
        STATE['updatedAt'] = now_iso()
        save_meta()
    return accepted, dup, ack_ids


def read_events_from(rev, gen):
    """取 rev > 指定值的事件；gen 不一致说明发生过回滚/重置，必须全量返回。"""
    since = 0 if gen != STATE['gen'] else int(rev or 0)
    out = []
    path = p('events.jsonl')
    if not os.path.exists(path):        # 全新部署 / 刚重置过，日志文件还没建
        return out
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except Exception:
                continue
            if ev.get('rev', 0) > since:
                out.append(ev)
    return out


def snapshot(reason):
    """破坏性操作前留一份快照，文件名里带 rev 与 gen 方便肉眼识别。"""
    src = p('events.jsonl')
    if not os.path.exists(src):
        return None
    name = 'g%d-r%d-%s-%s.jsonl' % (STATE['gen'], STATE['rev'], stamp(), reason)
    dst = p('versions', name)
    with open(src, 'r', encoding='utf-8') as f:
        data = f.read()
    with open(dst, 'w', encoding='utf-8') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    prune_versions()
    return name


def prune_versions():
    d = p('versions')
    try:
        files = sorted([f for f in os.listdir(d) if f.endswith('.jsonl')])
        for f in files[:-KEEP_VERSIONS]:
            os.remove(os.path.join(d, f))
    except Exception:
        pass


def list_versions():
    d = p('versions')
    out = []
    try:
        for f in sorted(os.listdir(d), reverse=True):
            if not f.endswith('.jsonl'):
                continue
            fp = os.path.join(d, f)
            stt = os.stat(fp)
            out.append({
                'file': f, 'bytes': stt.st_size,
                'ts': datetime.fromtimestamp(stt.st_mtime).strftime('%Y-%m-%d %H:%M:%S'),
            })
    except Exception:
        pass
    return out


# ----------------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------------
def ok_key(handler):
    cfg = read_json(p('config.json')) or {}
    want = cfg.get('keyHash') or ''
    if not want:
        # 还没设口令 —— 只允许 ping 和 setkey，其余一律拒绝，
        # 否则局域网里任何设备都能直接读写孩子的数据。
        return False, 'unset'
    got = (handler.headers.get('Authorization') or '').replace('Bearer', '').strip()
    if got and hmac.compare_digest(got.lower(), want.lower()):
        return True, 'ok'
    return False, 'bad'


class Handler(BaseHTTPRequestHandler):
    server_version = 'XYBServer/' + VERSION
    protocol_version = 'HTTP/1.1'

    # ---- 输出 ----
    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass                                        # 静音默认访问日志

    # ---- 请求 ----
    def do_OPTIONS(self):
        self.send_json({'ok': True})

    def do_GET(self):
        try:
            self.route_get()
        except Exception as e:
            log('GET %s 异常：%s\n%s' % (self.path, e, traceback.format_exc()))
            self.send_json({'ok': False, 'error': str(e)}, 500)

    def do_POST(self):
        try:
            self.route_post()
        except Exception as e:
            log('POST %s 异常：%s\n%s' % (self.path, e, traceback.format_exc()))
            self.send_json({'ok': False, 'error': str(e)}, 500)

    def body(self):
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0:
            return {}
        if n > MAX_BODY:
            raise ValueError('请求体过大：%d 字节' % n)
        return json.loads(self.rfile.read(n).decode('utf-8'))

    def qs(self):
        if '?' not in self.path:
            return {}
        out = {}
        for kv in self.path.split('?', 1)[1].split('&'):
            if '=' in kv:
                k, v = kv.split('=', 1)
                out[k] = v
        return out

    def path_only(self):
        return self.path.split('?', 1)[0].rstrip('/') or '/'

    def need_auth(self):
        good, why = ok_key(self)
        if not good:
            if why == 'unset':
                self.send_json({'ok': False, 'error': '服务端还没设置家庭口令',
                                'code': 'SETUP'}, 401)
            else:
                self.send_json({'ok': False, 'error': '口令不正确', 'code': 'AUTH'}, 401)
            return False
        return True

    # ---- GET ----
    def route_get(self):
        path = self.path_only()
        if path == '/api/ping':
            cfg = read_json(p('config.json')) or {}
            self.send_json({
                'ok': True, 'app': APP, 'version': VERSION,
                'gen': STATE['gen'], 'rev': STATE['rev'],
                'keySet': bool(cfg.get('keyHash')), 'serverTime': now_iso(),
            })
            return
        if not self.need_auth():
            return
        if path == '/api/events':
            q = self.qs()
            events = read_events_from(q.get('since', 0), int(q.get('gen', STATE['gen'])))
            self.send_json({'ok': True, 'gen': STATE['gen'], 'rev': STATE['rev'],
                            'count': len(events), 'events': events})
            return
        if path == '/api/info':
            self.send_json({
                'ok': True, 'app': APP, 'version': VERSION,
                'gen': STATE['gen'], 'rev': STATE['rev'],
                'devices': STATE['devices'],
                'updatedAt': STATE['updatedAt'], 'createdAt': STATE['createdAt'],
                'dir': STATE['dir'], 'eventIds': len(STATE['ids']),
                'versions': len(list_versions()),
            })
            return
        if path == '/api/versions':
            self.send_json({'ok': True, 'versions': list_versions()})
            return
        self.send_json({'ok': False, 'error': '未知接口 %s' % path}, 404)

    # ---- POST ----
    def route_post(self):
        path = self.path_only()

        # 设置/修改家庭口令（首次不需要鉴权，之后需要旧口令）
        if path == '/api/setkey':
            b = self.body()
            newk = (b or {}).get('key') or ''
            if len(str(newk)) < 4:
                self.send_json({'ok': False, 'error': '口令至少 4 位'}, 400)
                return
            cfg = read_json(p('config.json')) or {}
            if cfg.get('keyHash'):
                if not self.need_auth():
                    return
            cfg['keyHash'] = key_hash(newk)
            cfg['setAt'] = now_iso()
            cfg.setdefault('createdAt', now_iso())
            write_json_atomic(p('config.json'), cfg)
            log('家庭口令已%s' % ('更新' if cfg.get('setAt') else '设置'))
            self.send_json({'ok': True, 'set': True})
            return

        if not self.need_auth():
            return

        if path == '/api/sync':
            b = self.body() or {}
            device = str(b.get('device') or 'unknown')[:64]
            cgen = int(b.get('gen') or STATE['gen'])
            since = int(b.get('since') or 0)
            events = b.get('events') or []
            if not isinstance(events, list):
                self.send_json({'ok': False, 'error': 'events 必须是数组'}, 400)
                return
            if len(events) > MAX_EVENTS_PER_PUSH:
                self.send_json({'ok': False, 'error': '一次最多提交 %d 条事件' % MAX_EVENTS_PER_PUSH}, 400)
                return
            with LOCK:
                accepted, dup, ack_ids = append_events(events, device)
                back = read_events_from(since, cgen)
            self.send_json({
                'ok': True, 'gen': STATE['gen'], 'rev': STATE['rev'],
                'accepted': accepted, 'duplicated': dup,
                'ackIds': ack_ids,
                'count': len(back), 'events': back,
            })
            return

        if path == '/api/rollback':
            b = self.body() or {}
            target = int(b.get('rev') or 0)
            with LOCK:
                name = snapshot('before-rollback')
                events = [e for e in load_log() if e.get('rev', 0) <= target]
                with open(p('events.jsonl'), 'w', encoding='utf-8') as f:
                    for e in events:
                        f.write(json.dumps(e, ensure_ascii=False) + '\n')
                    f.flush()
                    os.fsync(f.fileno())
                STATE['ids'] = set(e['id'] for e in events if e.get('id'))
                STATE['rev'] = max([e.get('rev', 0) for e in events] or [0])
                STATE['gen'] += 1
                STATE['updatedAt'] = now_iso()
                save_meta()
            log('回滚到 rev=%d，快照 %s，新 gen=%d' % (target, name, STATE['gen']))
            self.send_json({'ok': True, 'gen': STATE['gen'], 'rev': STATE['rev'],
                            'snapshot': name, 'kept': len(events)})
            return

        if path == '/api/reset':
            b = self.body() or {}
            if not b.get('confirm'):
                self.send_json({'ok': False, 'error': '需要 confirm:true'}, 400)
                return
            with LOCK:
                name = snapshot('before-reset')
                with open(p('events.jsonl'), 'w', encoding='utf-8') as f:
                    f.flush()
                    os.fsync(f.fileno())
                STATE['ids'] = set()
                STATE['rev'] = 0
                STATE['gen'] += 1
                STATE['updatedAt'] = now_iso()
                save_meta()
            log('云端数据已重置，快照 %s，新 gen=%d' % (name, STATE['gen']))
            self.send_json({'ok': True, 'gen': STATE['gen'], 'rev': 0, 'snapshot': name})
            return

        self.send_json({'ok': False, 'error': '未知接口 %s' % path}, 404)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8100)
    ap.add_argument('--host', default='0.0.0.0')
    ap.add_argument('--data', default=r'C:\workspace\xiaoyuebing-data')
    ap.add_argument('--set-key', default='', help='设置家庭口令后退出')
    args = ap.parse_args()

    boot(args.data)
    if args.set_key:
        cfg = read_json(p('config.json')) or {}
        cfg['keyHash'] = key_hash(args.set_key)
        cfg['setAt'] = now_iso()
        cfg.setdefault('createdAt', now_iso())
        write_json_atomic(p('config.json'), cfg)
        log('家庭口令已设置')
        return

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    log('监听 http://%s:%d/  （Ctrl+C 停止）' % (args.host, args.port))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        log('收到停止信号，退出')
    finally:
        srv.server_close()


if __name__ == '__main__':
    main()
