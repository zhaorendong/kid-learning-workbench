/* ==========================================================================
   小悦饼学习工作台 · 多端同步层 (sync.js)
   --------------------------------------------------------------------------
   把 core.js 产生的事件推到 PC-C 上的数据服务，并把服务端的事件拉回来重算状态。

   为什么这样做（详见 docs/服务端数据同步设计.md）：
     服务端**不做合并**，只把事件按到达顺序追加进日志并分配 rev；
     客户端每次同步成功后用「服务端事件 + 本地待推送事件」重算一遍当前状态。
     所有设备拿到的事件集合与顺序一致 → 归约结果必然一致 → 多端自然收敛。

   几个关键设计：
     · 默认关闭。没开启时本文件几乎不做事，页面行为与从前完全一致。
     · 断网可用：事件先存本地 outbox，联网后自动补交；服务端按事件 id 去重，
       所以重传不会重复计数。
     · 口令不上网明文传：本地算 sha256('xyb::' + 口令) 作为 Bearer，
       服务端只存这个哈希。用的是自己实现的 sha256 ——
       因为站点跑在 http:// 下属于"非安全上下文"，浏览器不提供 crypto.subtle。
   ========================================================================== */
(function () {
  'use strict';

  var A = window.XYBApp;
  if (!A) return;

  /* ======================================================================
     1. SHA-256（纯 JS，无依赖）
     ====================================================================== */
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function sha256hex(msg) {
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
             0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var bytes = [], i;
    for (i = 0; i < msg.length; i++) {
      var c = msg.charCodeAt(i);
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    var bits = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    bytes.push(0, 0, 0, 0, (bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255);

    var w = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
      for (i = 0; i < 16; i++) {
        w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) |
               (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      }
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c2 = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c2) ^ (b & c2);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c2; c2 = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c2) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }

  /* ======================================================================
     2. 配置与请求
     ====================================================================== */
  /* 家长端输入框的预填值。每位使用者填自己家的数据服务地址，
     所以这里只放一个**示例**，不写死任何真实地址。 */
  var DEFAULT_URL = 'http://192.168.1.100:8100';
  var busy = false, timer = null, watcher = null;
  var listeners = [];

  function cfg() { return A.cloudCfg() || {}; }
  function base(u) { return String(u == null ? cfg().url : u || '').replace(/\/+$/, ''); }
  function keyHeader(key) {
    return key ? { 'Authorization': 'Bearer ' + sha256hex('xyb::' + key) } : {};
  }

  function req(url, key, path, method, body) {
    var opt = {
      method: method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, keyHeader(key)),
      cache: 'no-store'
    };
    if (body) opt.body = JSON.stringify(body);

    var ctl = null, to = null;
    if (typeof AbortController !== 'undefined') {
      ctl = new AbortController();
      opt.signal = ctl.signal;
      to = setTimeout(function () { ctl.abort(); }, 12000);
    }
    return fetch(url + path, opt).then(function (r) {
      if (to) clearTimeout(to);
      return r.text().then(function (txt) {
        var j = {};
        try { j = JSON.parse(txt); } catch (e) { j = {}; }
        if (!r.ok) {
          var err = new Error(j.error || ('HTTP ' + r.status));
          err.code = j.code || ('HTTP' + r.status);
          err.status = r.status;
          throw err;
        }
        return j;
      });
    }, function (e) {
      if (to) clearTimeout(to);
      var err = new Error('连不上数据服务（' + (e && e.message ? e.message : e) + '）');
      err.net = true;
      throw err;
    });
  }

  function call(path, method, body) { return req(base(), cfg().key, path, method, body); }

  /* ======================================================================
     3. 同步
     ====================================================================== */
  function hasLocalData() {
    var d = A.DB, s = A.stats();
    return !!(s.stars || s.doneCount || Object.keys(d.progress).length ||
              d.log.length || d.mistakes.length || d.hidden.length);
  }

  /* 连接测试：验口令；服务端还没设口令就顺手设置一次。
     不写入任何配置，等用户确认了模式再 activate()。 */
  function connect(url, key) {
    var u = base(url);
    if (!u) return Promise.reject(new Error('请填写服务器地址'));
    if (!key || String(key).length < 4) return Promise.reject(new Error('口令至少 4 位'));

    return req(u, key, '/api/ping', 'GET').then(function (p) {
      if (p.keySet) {
        return req(u, key, '/api/info', 'GET').then(function (info) {
          return { u: u, key: key, serverRev: info.rev || 0, setKey: false, info: info };
        });
      }
      return req(u, key, '/api/setkey', 'POST', { key: key }).then(function () {
        return { u: u, key: key, serverRev: 0, setKey: true };
      });
    }).then(function (r) {
      r.localHasData = hasLocalData();
      r.needChoice = r.serverRev > 0 && r.localHasData;
      return r;
    });
  }

  /* mode: 'cloud' = 以云端为准；'local' = 把本机数据作为新基线推上去 */
  function activate(url, key, mode) {
    var u = base(url), localSnap = A.snapshot();
    return req(u, key, '/api/events?since=0&gen=1', 'GET').then(function (res) {
      var events = res.events || [];
      var c = A.saveCloud({
        enabled: true, url: u, key: key,
        gen: res.gen || 1, rev: res.rev || 0,
        lastSyncAt: 0, lastError: '', activatedAt: Date.now()
      });
      if (mode === 'local' || !events.length) {
        /* 以本机为基线：事件流里加一个检查点，之后的状态以本机为准 */
        A.setRemoteEvents(events);
        A.rebuild();
        A.emit('checkpoint', { kind: 'import', snapshot: localSnap });
        return flush(true).then(function (r) {
          return { mode: events.length ? 'local-over' : 'seed', ok: r && r.ok !== false, err: r && r.error };
        });
      }
      A.setRemoteEvents(events);
      A.rebuild();
      return { mode: 'cloud', ok: true, rev: res.rev };
    });
  }

  function disable() {
    A.saveCloud(Object.assign({}, cfg(), { enabled: false, lastError: '' }));
    stopWatch();
    notify({ ok: true, action: 'disable' });
    return Promise.resolve({ ok: true });
  }

  /* 推本地待同步事件 + 拉服务端新事件，然后重算状态 */
  function flush(force) {
    var c = cfg();
    if (!c.enabled || !c.url || !c.key) return Promise.resolve({ skipped: true });
    if (busy) return Promise.resolve({ busy: true });
    busy = true;

    var body = {
      device: A.deviceId(),
      gen: c.gen || 1,
      since: c.rev || 0,
      events: A.outbox()
    };

    return call('/api/sync', 'POST', body).then(function (res) {
      var remote = A.remoteEvents();
      if ((res.gen || 1) !== (c.gen || 1)) remote = [];   /* 服务端回滚/重置过 → 丢掉旧事件 */

      var seen = {}, added = 0;
      remote.forEach(function (e) { seen[e.id] = 1; });
      (res.events || []).forEach(function (e) {
        if (!e || !e.id || seen[e.id]) return;
        seen[e.id] = 1; remote.push(e); added++;
      });
      A.setRemoteEvents(remote);

      var acked = {};
      (res.events || []).forEach(function (e) { if (e && e.id) acked[e.id] = 1; });
      /* 服务端还会明确回报"已经收到过"的那些事件 id —— 不把重复件一起 ack 掉的话，
         「已落盘但响应在回程丢了」的事件会每次重传、永远清不出队列 */
      (res.ackIds || []).forEach(function (id) { if (id) acked[id] = 1; });
      var left = A.outbox().filter(function (e) { return !acked[e.id]; });

      /* 兜底：服务端拒收的事件不能永远堆在本地 */
      var cutoff = Date.now() - 7 * 86400000;
      left = left.filter(function (e) { return (e.ts || 0) > cutoff; });
      if (left.length > 2000) left = left.slice(-2000);
      A.setOutbox(left);

      A.saveCloud(Object.assign({}, cfg(), {
        gen: res.gen, rev: res.rev,
        lastSyncAt: Date.now(), lastError: '', lastAccepted: res.accepted || 0
      }));

      A.rebuild();
      return { ok: true, rev: res.rev, accepted: res.accepted || 0, got: added, pending: left.length };
    }).catch(function (e) {
      A.saveCloud(Object.assign({}, cfg(), {
        lastError: e.message || String(e), lastTryAt: Date.now(),
        needKey: e.code === 'AUTH' || e.code === 'SETUP'
      }));
      return { ok: false, error: e.message, code: e.code };
    }).then(function (r) {
      busy = false;
      notify(r);
      return r;
    });
  }

  function schedule() {
    if (!cfg().enabled) return;
    if (timer) clearTimeout(timer);
    /* 攒一下再推，避免孩子连点把请求打爆 */
    timer = setTimeout(function () { timer = null; flush(); }, 2500);
  }

  function startWatch() {
    if (watcher) return;
    watcher = setInterval(function () {
      var c = cfg();
      if (!c.enabled) return;
      var stale = !c.lastSyncAt || (Date.now() - c.lastSyncAt > 60000);
      if (A.outbox().length || stale) flush();
    }, 30000);
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden' && A.outbox().length) flush();
        else if (document.visibilityState === 'visible' && cfg().enabled) flush();
      });
      window.addEventListener('pagehide', function () { if (A.outbox().length) flush(); });
    }
  }
  function stopWatch() { if (watcher) { clearInterval(watcher); watcher = null; } }

  /* ======================================================================
     4. 版本与回滚
     ====================================================================== */
  function versions() {
    return call('/api/versions', 'GET').then(function (r) { return r.versions || []; });
  }

  function rollback(rev) {
    return call('/api/rollback', 'POST', { rev: rev }).then(function (r) {
      A.setRemoteEvents([]);
      A.saveCloud(Object.assign({}, cfg(), { gen: r.gen, rev: 0, lastError: '' }));
      return flush(true).then(function (fr) {
        A.rebuild();
        return { ok: true, rev: r.rev, gen: r.gen, sync: fr };
      });
    });
  }

  function resetCloud() {
    return call('/api/reset', 'POST', { confirm: true }).then(function (r) {
      A.setRemoteEvents([]);
      A.setOutbox([]);
      A.saveCloud(Object.assign({}, cfg(), { gen: r.gen, rev: 0, lastError: '' }));
      A.rebuild();
      return { ok: true, gen: r.gen };
    });
  }

  function status() {
    var c = cfg();
    return {
      enabled: !!c.enabled, url: c.url || DEFAULT_URL, hasKey: !!c.key,
      rev: c.rev || 0, gen: c.gen || 1,
      pending: A.outbox().length,
      deviceId: A.deviceId(),
      lastSyncAt: c.lastSyncAt || 0,
      lastError: c.lastError || '',
      needKey: !!c.needKey,
      busy: busy
    };
  }

  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }
  function notify(r) {
    listeners.forEach(function (f) { try { f(r); } catch (e) {} });
  }

  /* 页面启动：若已启用同步，先同步一次再让界面渲染 */
  function boot() {
    if (!cfg().enabled) return Promise.resolve({ skipped: true });
    startWatch();
    return flush();
  }

  window.XYBSync = {
    DEFAULT_URL: DEFAULT_URL,
    sha256hex: sha256hex,
    connect: connect, activate: activate, disable: disable,
    flush: flush, schedule: schedule, boot: boot,
    versions: versions, rollback: rollback, resetCloud: resetCloud,
    status: status, onChange: onChange, hasLocalData: hasLocalData,
    isBusy: function () { return busy; }
  };
})();
