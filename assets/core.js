/* ==========================================================================
   小悦饼学习工作台 · 核心层 (core.js)
   --------------------------------------------------------------------------
   这一层被两个页面共用，不包含任何界面：

     index.html   孩子端  → assets/student.js
     parent.html  家长端  → assets/parent.js

   纯原生 JS，零依赖，零联网。数据只存在本机浏览器 localStorage。
   命名空间：xyb.v1.*  （v1 是数据版本，将来结构升级可平滑迁移）

   对外暴露：window.XYBApp
   ========================================================================== */
(function () {
  'use strict';

  var CAT = window.XYB_CATALOG || { modules: [], subjects: [], types: {} };
  var NS = 'xyb.v1.';
  var AVATARS = ['🐣', '🦊', '🐼', '🐯', '🦁', '🐨', '🐮', '🦄', '🐧', '🐢', '🚀', '⭐'];
  var TODAY = fmtDate(new Date());
  var STARS_PER_DONE = 3;
  var silent = false;   /* 家长端置 true：结算/上报时不弹提示、不撒彩带 */

  /* ======================================================================
     1. 数据层
     ====================================================================== */
  var Store = {
    read: function (key, fallback) {
      try {
        var raw = localStorage.getItem(NS + key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    write: function (key, val) {
      try { localStorage.setItem(NS + key, JSON.stringify(val)); } catch (e) {}
    },
    del: function (key) { try { localStorage.removeItem(NS + key); } catch (e) {} }
  };

  var DEFAULTS = {
    profile: {
      name: '小悦饼', avatar: '🐣', stars: 0, streakDays: 0,
      lastActiveDate: '', createdAt: TODAY
    },
    settings: {
      dailyGoal: 3,          /* 每天目标完成几个模块 */
      breakEvery: 20,        /* 连续学习多少分钟提醒休息 */
      breakOn: true,
      soundOn: true,
      parentPin: ''          /* 保留字段（PIN 实体存在 guard 里） */
    },
    achievements: {}
  };

  var DB = {
    profile: Object.assign({}, DEFAULTS.profile, Store.read('profile', {})),
    settings: Object.assign({}, DEFAULTS.settings, Store.read('settings', {})),
    progress: Store.read('progress', {}),      /* { moduleId: {...} } */
    log: Store.read('log', []),                /* [{ mid, ts, durMs, type }] */
    achievements: Store.read('achievements', {}),
    hidden: Store.read('hidden', []),          /* 家长隐藏的模块 id */
    mistakes: Store.read('mistakes', []),      /* 跨模块错题本 */
    save: function () {
      Store.write('profile', DB.profile);
      Store.write('settings', DB.settings);
      Store.write('progress', DB.progress);
      Store.write('achievements', DB.achievements);
      Store.write('hidden', DB.hidden);
      /* 只保留最近 500 条记录 / 300 道错题，避免 localStorage 膨胀 */
      if (DB.log.length > 500) DB.log = DB.log.slice(-500);
      if (DB.mistakes.length > 300) DB.mistakes = DB.mistakes.slice(-300);
      Store.write('log', DB.log);
      Store.write('mistakes', DB.mistakes);
    }
  };

  /* ======================================================================
     1.5 事件层（多端同步的基础）
     ----------------------------------------------------------------------
     为什么要有事件层：

       原来是"数据只在 localStorage"—— 清浏览器数据就没了，两台设备也互相看不见。
       现在把每一次学习行为变成一条**事件**，推到服务端（PC-C）长期留存：

           事件日志（服务端，只追加）   = 同步真相
           当前状态（localStorage）     = 把事件按顺序归约出来的缓存

     这样做换来三件事：

       1. 多端天然收敛 —— 所有设备拿到的是同一批事件 + 同一个顺序，
          归约出来的状态必然一样，于是**不需要写"合并算法"**，
          也就不会因为合并规则写错而丢数据。
       2. 重传安全 —— 事件带全局唯一 id（设备id:序号），服务端按 id 去重，
          网络抖动导致的重复提交不会重复计数。
       3. 回滚天然可行 —— 服务端把日志截断到某个 rev 就是一次历史版本，
          不需要额外的反向撤销逻辑。

     ⚠️ 同步**默认关闭**。关闭时行为与从前完全一致（localStorage 即真相），
        双击 file:// 打开、断网、没配服务器，都照常能用。
        只有家长端主动开启同步之后，事件层才开始记录。
     ====================================================================== */
  function cloudCfg() { return Store.read('cloud', { enabled: false }); }
  function saveCloud(cfg) { Store.write('cloud', cfg); return cfg; }

  function deviceId() {
    var d = Store.read('deviceId', '');
    if (!d) {
      d = 'dev-' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
      Store.write('deviceId', d);
    }
    return d;
  }
  function nextSeq() {
    var n = (Store.read('seq', 0) || 0) + 1;
    Store.write('seq', n);
    return n;
  }
  function outbox() { var o = Store.read('outbox', []); return Array.isArray(o) ? o : []; }
  function setOutbox(a) { Store.write('outbox', Array.isArray(a) ? a : []); }
  function remoteEvents() { var o = Store.read('events', []); return Array.isArray(o) ? o : []; }
  function setRemoteEvents(a) { Store.write('events', Array.isArray(a) ? a : []); }

  /* 记一条事件。注意：调用方**自己已经改了 DB**（本地立即生效，界面不卡），
     事件只是排队等推送；下次同步成功后 rebuild() 会用事件重算一遍作为权威结果。 */
  function emit(type, payload) {
    if (!cloudCfg().enabled) return null;      /* 没开同步就不记，避免无限增长 */
    var did = deviceId();
    var ev = Object.assign({ id: did + ':' + nextSeq(), t: type, ts: Date.now(), d: did },
      payload || {});
    var ob = outbox();
    ob.push(ev);
    if (ob.length > 8000) ob = ob.slice(-8000);
    setOutbox(ob);
    if (window.XYBSync && window.XYBSync.schedule) window.XYBSync.schedule();
    return ev;
  }

  /* ---------------- 事件归约 ---------------- */

  function resetDerived() {
    DB.profile = Object.assign({}, DEFAULTS.profile);
    DB.settings = Object.assign({}, DEFAULTS.settings);
    DB.progress = {}; DB.log = []; DB.achievements = {}; DB.hidden = []; DB.mistakes = [];
    Store.del('meta');
  }

  /* 导入备份 / 清空数据在事件流里表现为一个"检查点"，之后的事件叠加在它上面 */
  function loadSnapshot(s) {
    resetDerived();
    if (!s) return;
    if (s.profile) DB.profile = Object.assign({}, DEFAULTS.profile, s.profile);
    if (s.settings) DB.settings = Object.assign({}, DEFAULTS.settings, s.settings);
    if (s.progress) DB.progress = s.progress;
    if (s.achievements) DB.achievements = s.achievements;
    if (s.hidden) DB.hidden = s.hidden.slice();
    if (Array.isArray(s.log)) DB.log = s.log.slice();
    if (Array.isArray(s.mistakes)) {
      DB.mistakes = s.mistakes.map(function (m) {
        return Object.assign({ key: mistakeKey(m.mid, m.q) }, m);
      });
    }
    if (s.meta) Store.write('meta', s.meta);
    if (s.homework) Store.write(HW_KEY, s.homework);
  }

  function findMistakeByKey(key) {
    for (var i = 0; i < DB.mistakes.length; i++) if (DB.mistakes[i].key === key) return DB.mistakes[i];
    return null;
  }

  function bumpMetaRaw(key, add) {
    var m = Store.read('meta', {});
    m[key] = (m[key] || 0) + (add || 1);
    Store.write('meta', m);
  }

  /* 单条事件 → 状态变更。必须是**纯函数式**的（只看 ev 与当前状态），
     这样多端按同一顺序重放必然得到同一结果。 */
  function applyEvent(ev, dates) {
    var t = ev && ev.t, mid = ev && ev.mid, p;

    if (t === 'open') { if (dates) dates[fmtDate(new Date(ev.ts || Date.now()))] = 1; return; }

    if (t === 'checkpoint') {
      if (ev.kind === 'import' && ev.snapshot) loadSnapshot(ev.snapshot);
      else resetDerived();
      return;
    }

    if (t === 'enter') {
      DB.log.push({ id: ev.id, mid: mid, ts: ev.ts, type: 'enter' });
      p = DB.progress[mid] || {};            /* 让"最近学习"能反映打开动作 */
      p.lastAt = Math.max(p.lastAt || 0, ev.ts || 0);
      DB.progress[mid] = p;
      if (dates) dates[fmtDate(new Date(ev.ts || Date.now()))] = 1;
      return;
    }

    if (t === 'leave') {
      p = DB.progress[mid] || {};
      p.timeMs = (p.timeMs || 0) + (ev.durMs || 0);
      p.visits = (p.visits || 0) + 1;
      p.lastAt = Math.max(p.lastAt || 0, ev.ts || 0);
      DB.progress[mid] = p;
      DB.log.push({ id: ev.id, mid: mid, ts: ev.ts, durMs: ev.durMs, type: 'leave' });
      if (dates) dates[fmtDate(new Date(ev.ts || Date.now()))] = 1;
      return;
    }

    if (t === 'progress') {
      p = DB.progress[mid] || {};
      if (!p.lastAt || (ev.ts || 0) >= p.lastAt) {
        p.done = ev.done != null ? ev.done : p.done;
        p.total = ev.total != null ? ev.total : p.total;
        p.status = 'doing';
        p.lastAt = ev.ts;
      }
      DB.progress[mid] = p;
      return;
    }

    if (t === 'answer') {
      p = DB.progress[mid] || {};
      p.asked = (p.asked || 0) + 1;
      p.right = (p.right || 0) + (ev.correct ? 1 : 0);
      p.lastAt = Math.max(p.lastAt || 0, ev.ts || 0);
      DB.progress[mid] = p;
      if (!ev.correct && ev.q) {
        var key = mistakeKey(mid, ev.q), hit = findMistakeByKey(key);
        if (hit) {
          hit.times = (hit.times || 1) + 1;
          hit.ts = ev.ts;
          if (ev.my != null) hit.my = ev.my;
          hit.fixed = 0;                       /* 又错了 → 重新打开 */
        } else {
          DB.mistakes.push({
            key: key, mid: mid, tag: ev.tag || '', q: String(ev.q),
            answer: ev.answer == null ? '' : String(ev.answer),
            my: ev.my == null ? '' : String(ev.my),
            ts: ev.ts, times: 1, fixed: 0
          });
        }
      }
      if (dates) dates[fmtDate(new Date(ev.ts || Date.now()))] = 1;
      return;
    }

    if (t === 'finish') {
      p = DB.progress[mid] || {};
      var stars = ev.stars || STARS_PER_DONE;
      /* 只有"第一次"完成才加星 —— 事件集合相同则结果相同，多端不会重复加 */
      if (p.status !== 'done') {
        p.status = 'done';
        p.stars = Math.max(p.stars || 0, stars);
        p.finishedAt = ev.ts;
        DB.profile.stars += stars;
      }
      p.lastAt = Math.max(p.lastAt || 0, ev.ts || 0);
      DB.progress[mid] = p;
      if (dates) dates[fmtDate(new Date(ev.ts || Date.now()))] = 1;
      return;
    }

    if (t === 'mark') {                        /* 手动打勾 / 撤销 */
      p = DB.progress[mid] || {};
      if (!p.lastAt || (ev.ts || 0) >= p.lastAt) {
        if (ev.on) {
          if (p.status !== 'done') {
            p.status = 'done'; p.stars = STARS_PER_DONE; DB.profile.stars += STARS_PER_DONE;
          }
        } else if (p.status === 'done') {
          p.status = 'doing'; p.stars = 0;
          DB.profile.stars = Math.max(0, DB.profile.stars - STARS_PER_DONE);
        }
        p.lastAt = ev.ts;
        DB.progress[mid] = p;
      }
      if (dates) dates[fmtDate(new Date(ev.ts || Date.now()))] = 1;
      return;
    }

    if (t === 'profile') { Object.assign(DB.profile, ev.patch || {}); return; }
    if (t === 'settings') { Object.assign(DB.settings, ev.patch || {}); return; }
    if (t === 'hidden') { DB.hidden = (ev.value || []).slice(); return; }

    if (t === 'hw') {
      /* 作业打勾：只按事件里的 id 改 doneAt，重放多少次结果都一样（幂等），
         所以多端同步时不需要任何"合并规则"。 */
      var hd = hwData(), hi, hj, hk;
      for (hi = 0; hi < hd.days.length; hi++) {
        if (hd.days[hi].date !== ev.date) continue;
        var hb = hd.days[hi].blocks || [];
        for (hj = 0; hj < hb.length; hj++) {
          var ht = hb[hj].tasks || [];
          for (hk = 0; hk < ht.length; hk++) {
            if (ht[hk].id === ev.hid) ht[hk].doneAt = ev.on ? (ev.ts || Date.now()) : 0;
          }
        }
      }
      hwSave(hd);
      return;
    }

    if (t === 'mistake') {
      var m = findMistakeByKey(ev.key);
      /* 累计订正数由调用方发的 meta 事件统计，这里只改错题状态，避免重复计数 */
      if (ev.op === 'fix') { if (m && !m.fixed) m.fixed = ev.ts; return; }
      if (ev.op === 'unfix') { if (m) m.fixed = 0; return; }
      if (ev.op === 'del') {
        DB.mistakes = DB.mistakes.filter(function (x) { return x.key !== ev.key; });
        return;
      }
      return;
    }

    if (t === 'meta') { bumpMetaRaw(ev.key, ev.add || 1); return; }
  }

  function sortEvents(a, b) {
    /* 服务端事件带 rev（权威顺序）；本地待推送的事件排在最后（它们确实最新） */
    var ar = (a.rev == null ? Infinity : a.rev), br = (b.rev == null ? Infinity : b.rev);
    if (ar !== br) return ar - br;
    var at = a.ts || 0, bt = b.ts || 0;
    if (at !== bt) return at - bt;
    return String(a.id) < String(b.id) ? -1 : 1;
  }

  /* 连续天数只由"发生过学习的日期集合"决定 —— 派生量，不参与同步，多端天然一致 */
  function computeStreak(dates, today) {
    if (!dates) return 0;
    var d0 = new Date(today + 'T00:00:00');
    var start = dates[today] ? 0 : 1;          /* 今天还没学就从昨天起算 */
    var n = 0;
    for (var i = start; i < 400; i++) {
      if (dates[fmtDate(new Date(d0.getTime() - i * 86400000))]) n++;
      else break;
    }
    return n;
  }

  /* 用「服务端事件 + 本地待推送事件」重算当前状态。
     每次同步成功后调用，这是多端收敛的关键一步。 */
  function rebuild() {
    if (!cloudCfg().enabled) return false;
    var seen = {}, all = [];
    remoteEvents().concat(outbox()).forEach(function (e) {
      if (!e || !e.id || seen[e.id]) return;
      seen[e.id] = 1; all.push(e);
    });
    all.sort(sortEvents);

    var dates = {};
    resetDerived();
    all.forEach(function (ev) { applyEvent(ev, dates); });

    DB.profile.streakDays = computeStreak(dates, TODAY);
    var ds = Object.keys(dates).sort();
    DB.profile.lastActiveDate = ds.length ? ds[ds.length - 1] : '';

    /* 上限与当前实现保持一致，避免本地状态无界增长 */
    if (DB.log.length > 500) DB.log = DB.log.slice(-500);
    if (DB.mistakes.length > 300) DB.mistakes = DB.mistakes.slice(-300);

    /* 徽章是纯函数派生的，重放完补齐即可 */
    earnedIds().forEach(function (id) { if (!DB.achievements[id]) DB.achievements[id] = Date.now(); });

    DB.save();
    return true;
  }

  /* ---------------- 工具函数 ---------------- */
  function fmtDate(d) {
    var m = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (dd < 10 ? '0' + dd : dd);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function daysBetween(a, b) {
    if (!a || !b) return null;
    var t1 = new Date(a + 'T00:00:00'), t2 = new Date(b + 'T00:00:00');
    return Math.round((t2 - t1) / 86400000);
  }
  function moduleById(id) {
    for (var i = 0; i < CAT.modules.length; i++) if (CAT.modules[i].id === id) return CAT.modules[i];
    return null;
  }
  function subjectMeta(name) {
    for (var i = 0; i < (CAT.subjects || []).length; i++) if (CAT.subjects[i].name === name) return CAT.subjects[i];
    return { name: name, emoji: '📦', color: '#64748b' };
  }
  function typeMeta(t) { return (CAT.types && CAT.types[t]) || { label: '内容', emoji: '📄' }; }
  function visibleModules() {
    return CAT.modules.filter(function (m) { return DB.hidden.indexOf(m.id) < 0; });
  }
  function readyModules() { return visibleModules().filter(function (m) { return m.status !== 'planned'; }); }
  function prog(id) { return DB.progress[id] || null; }

  /* ======================================================================
     2. 行为记录
     ====================================================================== */
  function touchStreak() {
    var p = DB.profile;
    if (p.lastActiveDate === TODAY) return;
    var gap = daysBetween(p.lastActiveDate, TODAY);
    p.streakDays = (gap === 1) ? (p.streakDays + 1) : 1;
    p.lastActiveDate = TODAY;
    DB.save();
  }

  /* 进入模块：记录开始时间，返回时结算时长 */
  function enterModule(mod) {
    if (!mod) return;
    if (mod.status === 'planned') { toast('这个内容还在准备中，敬请期待 ' + (mod.emoji || '🚧')); return; }
    var ev = emit('enter', { mid: mod.id });
    DB.log.push({ id: ev ? ev.id : undefined, mid: mod.id, ts: ev ? ev.ts : Date.now(), type: 'enter' });
    DB.save();
    Store.write('session', { mid: mod.id, at: Date.now() });
    location.href = mod.url;
  }

  /* 结算上次离开时的学习时长（跨页面跳转也能算出来） */
  function settleSession() {
    var s = Store.read('session', null);
    if (!s || !s.at) return;
    Store.del('session');
    var dur = Date.now() - s.at;
    if (dur < 15000 || dur > 4 * 3600000) return;   /* 太短忽略，超过 4 小时视为挂机 */
    var p = prog(s.mid) || {};
    p.timeMs = (p.timeMs || 0) + dur;
    p.lastAt = Date.now();
    p.visits = (p.visits || 0) + 1;
    DB.progress[s.mid] = p;
    var ev = emit('leave', { mid: s.mid, durMs: dur });
    DB.log.push({ id: ev ? ev.id : undefined, mid: s.mid, ts: Date.now(), durMs: dur, type: 'leave' });
    touchStreak();
    DB.save();
    var m = moduleById(s.mid);
    if (!silent) toast('这次学了 ' + Math.max(1, Math.round(dur / 60000)) + ' 分钟' + (m ? ' · ' + m.title : '') + ' 👏');
  }

  /* 消费 SDK 写入的 inbox（模块是独立页面，无法直接调用本页函数） */
  function processInbox() {
    var q = Store.read('inbox', []);
    if (!Array.isArray(q) || !q.length) return;
    Store.del('inbox');
    q.forEach(function (item) {
      if (item && item.id) onModuleEvent({ id: item.id, event: item.event, data: item.data });
    });
  }

  /* 模块上报的事件（同源页面直接写 localStorage，iframe 内嵌则走 postMessage） */
  function onModuleEvent(detail) {
    if (!detail || !detail.id) return;
    if (detail.event === 'beat') return;          /* 心跳仅用于保活，不入库 */
    var d = detail.data || {};
    var p = prog(detail.id) || {};
    if (detail.event === 'ready') {
      p.lastAt = Date.now();
      DB.progress[detail.id] = p;
      DB.save();
      return;
    }
    if (detail.event === 'progress') {
      p.done = d.done != null ? d.done : p.done;
      p.total = d.total != null ? d.total : p.total;
      p.status = 'doing';
      emit('progress', { mid: detail.id, done: p.done, total: p.total });
    } else if (detail.event === 'finish') {
      var first = p.status !== 'done';
      p.status = 'done';
      p.stars = Math.max(p.stars || 0, d.stars || STARS_PER_DONE);
      p.finishedAt = Date.now();
      emit('finish', { mid: detail.id, stars: d.stars || STARS_PER_DONE });
      if (first) {
        DB.profile.stars += (d.stars || STARS_PER_DONE);
        if (!silent) celebrate();
      }
    } else if (detail.event === 'answer') {
      p.right = (p.right || 0) + (d.correct ? 1 : 0);
      p.asked = (p.asked || 0) + 1;
      emit('answer', {
        mid: detail.id, correct: !!d.correct, tag: d.tag || '',
        q: d.q || '', answer: d.answer, my: d.my
      });
      /* 答错且带题干 → 进错题本（老模块没带题干，不会误记） */
      if (!d.correct && d.q) recordMistake(detail.id, d.tag, d.q, d.answer, d.my);
    }
    p.lastAt = Date.now();
    DB.progress[detail.id] = p;
    touchStreak();
    DB.save();
    checkAchievements();
  }

  /* ======================================================================
     3. 错题本（跨模块聚合）
     ====================================================================== */
  function mistakeKey(mid, q) { return String(mid) + '|' + String(q); }

  function recordMistake(mid, tag, q, answer, my) {
    if (!q) return;
    var key = mistakeKey(mid, q), hit = null;
    for (var i = 0; i < DB.mistakes.length; i++) {
      if (DB.mistakes[i].key === key) { hit = DB.mistakes[i]; break; }
    }
    if (hit) {
      hit.times = (hit.times || 1) + 1;
      hit.ts = Date.now();
      if (my != null) hit.my = my;
      hit.fixed = 0;                       /* 同一题又错了 → 重新打开 */
    } else {
      DB.mistakes.push({
        key: key, mid: mid, tag: tag || '', q: String(q),
        answer: answer == null ? '' : String(answer),
        my: my == null ? '' : String(my),
        ts: Date.now(), times: 1, fixed: 0
      });
      if (DB.mistakes.length > 300) DB.mistakes = DB.mistakes.slice(-300);
    }
    DB.save();
  }

  function listMistakes(opt) {
    opt = opt || {};
    var arr = DB.mistakes.slice();
    if (opt.mid) arr = arr.filter(function (m) { return m.mid === opt.mid; });
    if (opt.pending) arr = arr.filter(function (m) { return !m.fixed; });
    if (opt.fixed) arr = arr.filter(function (m) { return !!m.fixed; });
    arr.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    return arr;
  }
  function findMistake(key) {
    for (var i = 0; i < DB.mistakes.length; i++) if (DB.mistakes[i].key === key) return DB.mistakes[i];
    return null;
  }
  function fixMistake(key) {
    var m = findMistake(key);
    if (m) { m.fixed = Date.now(); m.ts = m.ts || Date.now(); emit('mistake', { key: key, op: 'fix' }); DB.save(); }
  }
  function unfixMistake(key) {
    var m = findMistake(key);
    if (m) { m.fixed = 0; emit('mistake', { key: key, op: 'unfix' }); DB.save(); }
  }
  function delMistake(key) {
    DB.mistakes = DB.mistakes.filter(function (m) { return m.key !== key; });
    emit('mistake', { key: key, op: 'del' });
    DB.save();
  }
  function mistakeStats() {
    var total = DB.mistakes.length, pending = 0, fixedN = 0, mods = {};
    DB.mistakes.forEach(function (m) {
      if (m.fixed) fixedN++; else pending++;
      mods[m.mid] = (mods[m.mid] || 0) + 1;
    });
    return { total: total, pending: pending, fixed: fixedN, moduleCount: Object.keys(mods).length, byModule: mods };
  }

  /* ======================================================================
     4. 成就体系
     ====================================================================== */
  var ACHIEVEMENTS = [
    { id: 'first', ic: '🌟', name: '启蒙之星', desc: '完成第一个学习内容',
      test: function (s) { return s.doneCount >= 1; } },
    { id: 'three', ic: '📚', name: '小学者', desc: '完成 3 个学习内容',
      test: function (s) { return s.doneCount >= 3; } },
    { id: 'ten', ic: '🎓', name: '博学小达人', desc: '完成 10 个学习内容',
      test: function (s) { return s.doneCount >= 10; } },
    { id: 'focus', ic: '⏳', name: '专注力', desc: '累计学习满 60 分钟',
      test: function (s) { return s.totalMin >= 60; } },
    { id: 'deep', ic: '🧠', name: '深度思考', desc: '累计学习满 300 分钟',
      test: function (s) { return s.totalMin >= 300; } },
    { id: 'streak3', ic: '🔥', name: '坚持三天', desc: '连续学习 3 天',
      test: function (s) { return s.streak >= 3; } },
    { id: 'streak7', ic: '🏅', name: '自律之星', desc: '连续学习 7 天',
      test: function (s) { return s.streak >= 7; } },
    { id: 'star15', ic: '✨', name: '闪闪发光', desc: '收集 15 颗星星',
      test: function (s) { return s.stars >= 15; } },
    { id: 'smart', ic: '🎯', name: '神算子', desc: '累计答对 50 道题',
      test: function (s) { return s.right >= 50; } },
    { id: 'explore', ic: '🧭', name: '探索者', desc: '打开过 5 个不同内容',
      test: function (s) { return s.visited >= 5; } },
    { id: 'fixer', ic: '🔁', name: '错题克星', desc: '订正 5 道错题',
      test: function (s) { return s.fixedMistakes >= 5; } },
    { id: 'clean', ic: '🧹', name: '一题不留', desc: '把错题本清空一次',
      test: function (s) { return s.clearedOnce; } }
  ];

  function stats() {
    var doneCount = 0, totalMin = 0, right = 0, asked = 0, visited = 0;
    var now = Date.now();
    for (var k in DB.progress) {
      var p = DB.progress[k];
      if (p.status === 'done') doneCount++;
      if (p.visits) visited++;
      if (p.asked) { right += p.right || 0; asked += p.asked; }
    }
    DB.log.forEach(function (r) { if (r.durMs) totalMin += r.durMs / 60000; });
    /* 本周（最近 7 天） */
    var weekMs = 0, todayMs = 0;
    DB.log.forEach(function (r) {
      if (!r.durMs) return;
      if (now - r.ts < 7 * 86400000) weekMs += r.durMs;
      if (fmtDate(new Date(r.ts)) === TODAY) todayMs += r.durMs;
    });
    var ms = mistakeStats();
    return {
      doneCount: doneCount, totalMin: Math.round(totalMin), weekMin: Math.round(weekMs / 60000),
      todayMin: Math.round(todayMs / 60000),
      right: right, asked: asked, visited: visited, streak: DB.profile.streakDays || 0,
      stars: DB.profile.stars || 0,
      accuracy: asked ? Math.round(right / asked * 100) : null,
      mistakes: ms.total, mistakesPending: ms.pending,
      fixedMistakes: (Store.read('meta', {}).fixedMistakes || 0),
      clearedOnce: !!(Store.read('meta', {}).clearedOnce),
      todayDone: DB.log.filter(function (r) {
        return r.type === 'leave' && fmtDate(new Date(r.ts)) === TODAY;
      }).length
    };
  }

  function bumpMeta(key, add) {
    var m = Store.read('meta', {});
    m[key] = (m[key] || 0) + (add || 1);
    Store.write('meta', m);
    emit('meta', { key: key, add: add || 1 });
  }

  function earnedIds() {
    var s = stats(), out = [];
    ACHIEVEMENTS.forEach(function (a) { if (a.test(s)) out.push(a.id); });
    return out;
  }
  function checkAchievements() {
    var got = earnedIds(), fresh = [];
    got.forEach(function (id) {
      if (!DB.achievements[id]) { DB.achievements[id] = Date.now(); fresh.push(id); }
    });
    if (fresh.length) {
      DB.save();
      if (!silent) fresh.forEach(function (id) {
        var a = ACHIEVEMENTS.filter(function (x) { return x.id === id; })[0];
        if (a) toast('获得徽章 ' + a.ic + ' ' + a.name + '！');
      });
    }
  }

  /* ======================================================================
     5. 提示 / 弹层 / 彩带（两端共用，页面里需要 #toast 节点）
     ====================================================================== */
  function sheet(title, sub, html) {
    closeSheet();
    var mask = document.createElement('div');
    mask.className = 'sheet-mask';
    mask.innerHTML = '<div class="sheet" style="position:relative">' +
      '<button class="sheet-close" data-close>✕</button>' +
      '<h3>' + title + '</h3><p class="sh">' + sub + '</p>' + html + '</div>';
    mask.addEventListener('click', function (e) {
      if (e.target === mask || e.target.hasAttribute('data-close')) closeSheet();
    });
    document.body.appendChild(mask);
  }
  function closeSheet() {
    var el = document.querySelector('.sheet-mask');
    if (el) el.remove();
  }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2400);
  }
  function celebrate() {
    var box = document.createElement('div');
    box.className = 'confetti';
    var colors = ['#4f8ef7', '#a855f7', '#f59e0b', '#10b981', '#ec4899', '#06b6d4'];
    var s = '';
    for (var i = 0; i < 44; i++) {
      s += '<i style="left:' + (Math.random() * 100) + '%;top:-20px;background:' +
        colors[i % colors.length] + ';animation-duration:' + (1.6 + Math.random() * 1.5) +
        's;animation-delay:' + (Math.random() * .5) + 's"></i>';
    }
    box.innerHTML = s;
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 3400);
  }
  function kpi(ic, lb, vl, unit, dt) {
    return '<div class="kpi"><div class="lb">' + ic + ' ' + lb + '</div>' +
      '<div class="vl">' + vl + '<small>' + (unit || '') + '</small></div>' +
      '<div class="dt">' + dt + '</div></div>';
  }

  /* ======================================================================
     6. 数据导入导出 / 清空
     ====================================================================== */
  function exportData() {
    var data = {
      app: '小悦饼学习工作台', version: CAT.version || 1, exportedAt: new Date().toISOString(),
      profile: DB.profile, settings: DB.settings, progress: DB.progress,
      log: DB.log, achievements: DB.achievements, hidden: DB.hidden, mistakes: DB.mistakes,
      homework: Store.read(HW_KEY, null)
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '小悦饼学习数据_' + TODAY + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    toast('学习数据已导出 ✅');
  }

  function importData(file, done) {
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var d = JSON.parse(fr.result);
        if (!d || typeof d !== 'object') throw new Error('格式错误');
        if (d.profile) DB.profile = Object.assign({}, DEFAULTS.profile, d.profile);
        if (d.settings) DB.settings = Object.assign({}, DEFAULTS.settings, d.settings);
        if (d.progress) DB.progress = d.progress;
        if (d.achievements) DB.achievements = d.achievements;
        if (d.hidden) DB.hidden = d.hidden;
        if (Array.isArray(d.log)) DB.log = d.log;
        if (Array.isArray(d.mistakes)) {
          DB.mistakes = d.mistakes.map(function (m) {
            return Object.assign({ key: mistakeKey(m.mid, m.q) }, m);
          });
        }
        if (d.homework) Store.write(HW_KEY, d.homework);
        /* 导入在事件流里表现为一个"检查点"：之前的历史被这份快照取代 */
        emit('checkpoint', { kind: 'import', snapshot: d });
        DB.save();
        closeSheet();
        toast('数据导入成功 ✅');
        if (typeof done === 'function') done();
      } catch (e) { toast('导入失败：文件不是有效的数据备份'); }
    };
    fr.readAsText(file);
  }

  function clearAllData() {
    /* 开了同步的话，清空也要让对方知道 —— 记一个"重置检查点"事件 */
    emit('checkpoint', { kind: 'reset' });
    ['profile', 'settings', 'progress', 'log', 'achievements', 'hidden', 'session', 'inbox',
     'mistakes', 'meta', 'homework'].forEach(Store.del);
    DB.profile = Object.assign({}, DEFAULTS.profile);
    DB.settings = Object.assign({}, DEFAULTS.settings);
    DB.progress = {}; DB.log = []; DB.achievements = {}; DB.hidden = []; DB.mistakes = [];
    DB.save();
  }

  /* 每天第一次打开记一条 open 事件（连续天数由活动日期集合派生） */
  function markOpened() {
    if (!cloudCfg().enabled) return;
    if (Store.read('openDate', '') === TODAY) return;
    Store.write('openDate', TODAY);
    emit('open', {});
  }

  /* ======================================================================
     作业模块（老师每天留的作业）
     ----------------------------------------------------------------------
     为什么放在核心层、而不是 modules/<id>/ 里：
       作业是"每天要看、要打勾"的核心数据，不是一节课的内容。
       放核心层才能直接共享 localStorage 与多端同步（事件类型 hw），
       也才能直接上首页卡片和底部导航。

     三条数据约定（都是踩过坑之后的决定）：
       1. **老师原文（raw）一定留档** —— 解析不可能 100% 准，家长要能对照原文，
          以后改了解析规则还能一键重解析；
       2. 每条任务同时存 `text`（一句短话，给孩子看）和 `full`（原文，给家长看）——
          一年级孩子读不了长句，"自愿练习＞＜＝三种符号的书写"要在孩子端变成"练习＞＝＜的写法"；
       3. 打勾状态就是任务上的 `doneAt`，同步时表现为一条 hw 事件（和错题订正同一套机制）。
     ====================================================================== */
  var HW_KEY = 'homework';

  function hwData() {
    var d = Store.read(HW_KEY, null);
    if (!d || !Array.isArray(d.days)) d = { version: 1, days: [] };
    return d;
  }
  function hwSave(d) { Store.write(HW_KEY, d); return d; }
  function hwDays() {
    return hwData().days.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
  }
  function hwDay(date) {
    var ds = hwData().days;
    for (var i = 0; i < ds.length; i++) if (ds[i].date === date) return ds[i];
    return null;
  }
  /* 按日期写入（同一天重复录入 = 更新，且尽量保留已经打过的勾） */
  function hwUpsertDay(day) {
    var d = hwData(), i, found = -1;
    for (i = 0; i < d.days.length; i++) if (d.days[i].date === day.date) { found = i; break; }
    if (found >= 0) {
      var kept = {};
      (d.days[found].blocks || []).forEach(function (b) {
        (b.tasks || []).forEach(function (t) { if (t.doneAt) kept[t.full || t.text] = t.doneAt; });
      });
      (day.blocks || []).forEach(function (b) {
        (b.tasks || []).forEach(function (t) {
          if (!t.doneAt && kept[t.full || t.text]) t.doneAt = kept[t.full || t.text];
        });
      });
      d.days[found] = day;
    } else {
      d.days.push(day);
    }
    hwSave(d);
    return day;
  }
  function hwRemoveDay(date) {
    var d = hwData();
    d.days = d.days.filter(function (x) { return x.date !== date; });
    hwSave(d);
  }
  function hwToggle(date, id, on) {
    var d = hwData(), i, j, k, hit = null;
    for (i = 0; i < d.days.length; i++) {
      if (d.days[i].date !== date) continue;
      var bl = d.days[i].blocks || [];
      for (j = 0; j < bl.length; j++) {
        var ts = bl[j].tasks || [];
        for (k = 0; k < ts.length; k++) if (ts[k].id === id) hit = ts[k];
      }
    }
    if (!hit) return null;
    hit.doneAt = (on === false) ? 0 : (hit.doneAt ? 0 : Date.now());
    hwSave(d);
    /* 打勾要能让别的设备看到 → 记一条事件（和错题订正同一套同步机制） */
    emit('hw', { date: date, hid: id, on: !!hit.doneAt });
    return hit;
  }
  /* 今天的作业进度（班级通知那类"家长待办"不计入孩子的进度）。
     不传日期时：优先今天的，今天还没有记录就退回**最近一天** ——
     老师晚上发、孩子第二天早上看，或者家长补录昨天的，都不该显示成"没有作业"。 */
  function hwStats(date) {
    var d = date || TODAY;
    var day = hwDay(d) || (date ? null : (hwDays()[0] || null));
    var total = 0, done = 0, parentLeft = 0;
    if (day) {
      (day.blocks || []).forEach(function (b) {
        (b.tasks || []).forEach(function (t) {
          if (b.cls) { if (!t.doneAt) parentLeft++; return; }
          total++;
          if (t.doneAt) done++;
        });
      });
    }
    return { has: !!day, day: day, total: total, done: done, left: total - done, parentLeft: parentLeft };
  }
  /* 家长待办：班级通知里那些"要爸爸妈妈做的事"，没做掉的都列出来。
     和孩子的任务不同，这类事经常跨天（疫苗要等到周日、帽子要写名字），
     所以不按"今天"过滤，只看最近 7 天，免得越积越多。
     踩过的坑：这些条目都在 `cls: true` 的班级通知板块里，早先按"非班级板块"过滤，
     结果一条都取不出来 —— 家长待办始终是空的。 */
  function hwPending(date) {
    var out = [], today = date || TODAY, floor = '';
    try {
      var d = new Date(today + 'T00:00:00');
      d.setDate(d.getDate() - 7);
      floor = fmtDate(d);
    } catch (e) {}
    hwDays().forEach(function (day) {
      if (day.date > today) return;
      if (floor && day.date < floor) return;
      (day.blocks || []).forEach(function (b) {
        (b.tasks || []).forEach(function (t) {
          if ((b.cls || t.forParent) && !t.doneAt) out.push({ date: day.date, task: t });
        });
      });
    });
    return out;
  }

  /* ---------------- 解析老师原文 ---------------- */
  var HW_SUBJECTS = [
    { key: '数学', emoji: '🔢', color: '#f59e0b' },
    { key: '语文', emoji: '📖', color: '#3b82f6' },
    { key: '英语', emoji: '🔤', color: '#10b981' },
    { key: '美文朗读', emoji: '🎧', color: '#06b6d4' },
    { key: '班级通知', emoji: '📣', color: '#8b5cf6', cls: true }
  ];
  /* 动词表：一年级孩子的作业动词其实是有限集合，识别出来就能配图标（以后还能配音） */
  var HW_VERBS = [
    { re: /背一背|背诵|背给|默写/, icon: '🧠', verb: '背一背' },
    { re: /读一读|指读|朗读|读给|读准/, icon: '🗣', verb: '读一读' },
    { re: /练一练|写一写|书写|练习|生字本|字帖|改错|订正|改正/, icon: '✍️', verb: '写一写' },
    { re: /说一说|想一想|组词|造句|口头/, icon: '💡', verb: '说一说' },
    { re: /做一做|实践|动手|剪|摆|比一比|找一找|数一数|整理/, icon: '🧩', verb: '做一做' },
    { re: /带回来|带回|带去|明日带|明天带|交给老师/, icon: '🎒', verb: '带回来' },
    { re: /疫苗|接种|体检|打针/, icon: '💉', verb: '记一记' },
    { re: /家长|私信|配合|协助|留意|注意|安全|签/, icon: '👨‍👩‍👧', verb: '提醒家长' }
  ];
  var HW_PARENT_RE = /家长|私信|留意|注意|安全|协助|配合|签|帮孩子|写好/;

  function hwStripEmoji(s) {
    return String(s == null ? '' : s)
      .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ')          /* emoji 主体（代理对） */
      .replace(/[\u2600-\u27BF\u2B00-\u2BFF\uFE0F\u20E3]/g, ' ') /* 符号类 emoji 与组合键 */
      .replace(/\s+/g, ' ')
      .trim();
  }
  function hwStripLead(s) {
    return String(s)
      .replace(/^\s*[（(]?\d{1,2}\s*[)）]?\s*[.、,，:：]?\s*/, '')   /* 1. / 1、 / (1) */
      .replace(/^[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '')
      .replace(/^[.、,，:：\-–—•·●■◆※]+\s*/, '')
      .trim();
  }
  /* 清洗一条任务文本：去掉序号/emoji/"自愿"这类不给孩子看的字样 */
  function hwClean(s) {
    var t = hwStripLead(hwStripEmoji(s));
    t = t.replace(/[（(]\s*(均为|全为|都)?自愿[^）)]{0,8}[)）]/g, '');
    t = t.replace(/(均为|全为|都是)?自愿(完成|练习|参与|做|完成即可)?/g, '');
    t = t.replace(/【|】/g, '');
    t = t.replace(/\s{2,}/g, ' ');
    t = t.replace(/^[，。、；;：:\s]+/, '').replace(/[。\s]+$/, '');
    return t.trim();
  }
  /* 给孩子看的一句短话：先切到第一个句末标点，再按逗号/括号收敛 */
  function hwShort(s, max) {
    max = max || 22;
    var t = String(s || '');
    var cut = t.length, marks = ['。', '；', ';', '：', ':', '（', '('];
    marks.forEach(function (c) { var i = t.indexOf(c); if (i > 2 && i < cut) cut = i; });
    var head = t.slice(0, cut);
    if (head.length > max) {
      var j = head.indexOf('，');
      if (j > 4 && j <= max) head = head.slice(0, j);
      else head = head.slice(0, max) + '…';
    }
    return head.replace(/[，,、\s]+$/, '').trim();
  }
  function hwMetaOf(s, subj) {
    var t = String(s || '');
    var head = hwClean(s).slice(0, 12);      /* 先只看开头，免得后半句的"说一说"把动词抢走 */
    var i;
    for (i = 0; i < HW_VERBS.length; i++) {
      if (HW_VERBS[i].re.test(head)) return { icon: HW_VERBS[i].icon, verb: HW_VERBS[i].verb };
    }
    for (i = 0; i < HW_VERBS.length; i++) {
      if (HW_VERBS[i].re.test(t)) return { icon: HW_VERBS[i].icon, verb: HW_VERBS[i].verb };
    }
    return { icon: subj && subj.cls ? '📣' : '📌', verb: subj && subj.cls ? '记一记' : '做一做' };
  }
  function hwSubjectOf(title) {
    var t = String(title || '');
    for (var i = 0; i < HW_SUBJECTS.length; i++) {
      if (t.indexOf(HW_SUBJECTS[i].key) >= 0) return HW_SUBJECTS[i];
    }
    if (/通知|班级|事项/.test(t)) return HW_SUBJECTS[HW_SUBJECTS.length - 1];
    return { key: t || '其它', emoji: '📌', color: '#64748b' };
  }
  /* 页码/书名的引用，家长核对用 */
  function hwRefOf(s) {
    var t = String(s || ''), out = [];
    var pages = t.match(/第?\s*\d{1,3}\s*页|附页/g);
    if (pages) out.push(pages.join('、'));
    var books = t.match(/《[^》]{1,20}》/g);
    if (books) out = out.concat(books);
    return out.join(' ');
  }
  /* 截止/要带东西的日期：绝对日期（9月20日）或相对（明日/明天） */
  function hwDueOf(s, baseDate) {
    var t = String(s || '');
    var m = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (m) {
      var y = baseDate ? Number(baseDate.slice(0, 4)) : new Date().getFullYear();
      var mm = Number(m[1]), dd = Number(m[2]);
      var str = y + '-' + (mm < 10 ? '0' + mm : mm) + '-' + (dd < 10 ? '0' + dd : dd);
      /* 跨年（12 月的通知提到 1 月）兜一下 */
      if (baseDate && str < baseDate) str = (y + 1) + str.slice(4);
      return str;
    }
    if (/明日|明天/.test(t) && baseDate) {
      var d = new Date(baseDate + 'T00:00:00');
      d.setDate(d.getDate() + 1);
      return fmtDate(d);
    }
    return '';
  }
  function hwIsTaskLine(line) {
    var raw = String(line || '').replace(/^\s+/, '');
    /* 序号有四种写法，都要认：1️⃣（键盘帽）、①、1. 、1、 */
    if (/^[1-9]\uFE0F?\u20E3/.test(raw)) return true;
    if (/^[\u2460-\u2473]/.test(raw)) return true;
    var t = hwStripEmoji(raw);
    if (!t) return false;
    if (/^[\u2460-\u2473]/.test(t)) return true;
    if (/^[（(]?\d{1,2}\s*[.、)）]/.test(t)) return true;
    if (/^\d{1,2}\s*[：:]\s*\S/.test(t)) return true;
    return false;
  }
  /* 按行切板块：**只有行首**的【xx】才算板块标题。
     踩过的坑：语文那条"1️⃣说一说：【六、八】的笔顺和组词"里的【六、八】
     是内容里的引号，按全文正则切会凭空多出一个"六、八"板块。 */
  function hwSplitBlocks(raw) {
    var out = [], cur = null;
    String(raw || '').split('\n').forEach(function (line) {
      var m = line.match(/^\s*【([^】]{1,14})】\s*(.*)$/);
      if (m) {
        if (cur) out.push(cur);
        cur = { title: m[1].trim(), body: (m[2] || '') + '\n' };
      } else if (cur) {
        cur.body += line + '\n';
      }
    });
    if (cur) out.push(cur);
    return out;
  }
  /* 主入口：老师原文 → 一天的结构化作业 */
  function hwParse(raw, dateHint) {
    var text = String(raw || '').replace(/\r\n?/g, '\n');
    var dm = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    var year = new Date().getFullYear();
    var date = dateHint || (dm
      ? year + '-' + (Number(dm[1]) < 10 ? '0' + Number(dm[1]) : Number(dm[1])) +
        '-' + (Number(dm[2]) < 10 ? '0' + Number(dm[2]) : Number(dm[2]))
      : fmtDate(new Date()));

    var blocks = hwSplitBlocks(text);
    if (!blocks.length) {
      /* 没有【】分块：整段当"班级通知"处理，至少不丢内容 */
      blocks = [{ title: '班级通知', body: text }];
    }

    var day = { date: date, raw: text, parsedAt: Date.now(), blocks: [] };
    var n = 0;

    blocks.forEach(function (b) {
      var subj = hwSubjectOf(b.title);
      var lines = b.body.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      var learned = [], tasks = [];

      lines.forEach(function (line) {
        var head = hwStripEmoji(line);
        var isMarker = /回家(学习)?任务|今日回家|回家做/.test(head);
        if (hwIsTaskLine(line) && !isMarker) {
          var clean = hwClean(line);
          if (!clean || clean.length < 3) return;
          /* 动词单独拎出来显示，就从正文里去掉，避免"说一说：说一说…" */
          var meta = hwMetaOf(line, subj);
          var bodyTxt = clean.replace(
            /^(说一说|想一想|背一背|读一读|练一练|写一写|做一做|数一数|比一比|找一找|记一记)\s*[：:，,、]?\s*/, '')
            /* "实践小活动：家里找…" 这种"标签+冒号"的前缀也去掉，孩子只需看后半句 */
            .replace(/^[^：:]{0,6}(活动|小活动|任务|作业|要求)\s*[：:]\s*/, '');
          if (!bodyTxt) bodyTxt = clean;
          n++;
          tasks.push({
            id: 'h-' + date.replace(/-/g, '') + '-' + n,
            icon: meta.icon,
            verb: meta.verb,
            text: hwShort(bodyTxt),
            full: bodyTxt,
            ref: hwRefOf(line),
            due: hwDueOf(line, date),
            forParent: !!subj.cls && HW_PARENT_RE.test(line),
            doneAt: 0
          });
        } else if (!isMarker && head.length > 3 && learned.length < 3) {
          learned.push(head);
        }
      });

      if (learned.length || tasks.length) {
        day.blocks.push({
          subject: subj.key,
          emoji: subj.emoji,
          color: subj.color,
          cls: !!subj.cls,
          learned: learned.join(' ').slice(0, 160),
          tasks: tasks
        });
      }
    });

    if (!day.blocks.length) return null;
    return day;
  }

  /* ======================================================================
     7. 对外暴露
     ====================================================================== */
  var API = {
    NS: NS, CAT: CAT, AVATARS: AVATARS, TODAY: TODAY,
    Store: Store, DEFAULTS: DEFAULTS, DB: DB, ACHIEVEMENTS: ACHIEVEMENTS,
    STARS_PER_DONE: STARS_PER_DONE,
    setSilent: function (v) { silent = !!v; },

    /* ---- 事件层 / 多端同步（细节见 sync.js）---- */
    deviceId: deviceId, cloudCfg: cloudCfg, saveCloud: saveCloud, emit: emit,
    rebuild: rebuild, outbox: outbox, setOutbox: setOutbox,
    remoteEvents: remoteEvents, setRemoteEvents: setRemoteEvents,
    computeStreak: computeStreak,
    /* 导出当前状态的快照（开启同步时作为基线检查点用） */
    snapshot: function () {
      return {
        profile: DB.profile, settings: DB.settings, progress: DB.progress,
        log: DB.log, achievements: DB.achievements, hidden: DB.hidden,
        mistakes: DB.mistakes, meta: Store.read('meta', {}),
        homework: Store.read(HW_KEY, null)
      };
    },

    fmtDate: fmtDate, esc: esc, daysBetween: daysBetween,
    moduleById: moduleById, subjectMeta: subjectMeta, typeMeta: typeMeta,
    visibleModules: visibleModules, readyModules: readyModules, prog: prog,

    touchStreak: touchStreak, enterModule: enterModule,
    settleSession: settleSession, processInbox: processInbox, onModuleEvent: onModuleEvent,

    stats: stats, earnedIds: earnedIds, checkAchievements: checkAchievements, bumpMeta: bumpMeta,

    /* ---- 作业（每天老师留的作业）---- */
    homework: {
      days: hwDays, day: hwDay, parse: hwParse, upsert: hwUpsertDay,
      remove: hwRemoveDay, toggle: hwToggle, stats: hwStats, pending: hwPending,
      subjects: HW_SUBJECTS, verbs: HW_VERBS
    },

    mistakes: {
      list: listMistakes, find: findMistake, record: recordMistake,
      fix: fixMistake, unfix: unfixMistake, remove: delMistake, stats: mistakeStats,
      key: mistakeKey
    },

    sheet: sheet, closeSheet: closeSheet, toast: toast, celebrate: celebrate, kpi: kpi,
    exportData: exportData, importData: importData, clearAllData: clearAllData,

    /* 两个页面共用的启动步骤（不含渲染） */
    bootCore: function () {
      settleSession();
      processInbox();
      markOpened();
      DB.save();
    }
  };

  window.XYBApp = API;
})();
