/* ==========================================================================
   小悦饼学习工作台 · 家长端 (parent.js)
   --------------------------------------------------------------------------
   由 parent.html 加载，与孩子端物理隔离：
     · 孩子端（index.html）里没有任何家长设置界面，只有页脚一个入口链接
     · 本页所有内容被 PIN 门禁挡住，验证通过前不渲染任何数据

   门禁说明（如实告知，不做假安全）：
     · 4~6 位数字密码，只存在本机 localStorage（xyb.v1.guard），哈希后保存
     · 连续输错 3 次锁定 60 秒，防孩子乱试
     · 忘记密码：在浏览器控制台执行
         localStorage.removeItem('xyb.v1.guard')
       然后刷新本页即可重设。家人自用的场景下这是最稳妥、没有后门的做法。
   ========================================================================== */
(function () {
  'use strict';

  var A = window.XYBApp;
  var DB = A.DB, CAT = A.CAT, AVATARS = A.AVATARS;
  var esc = A.esc, prog = A.prog, kpi = A.kpi;

  A.setSilent(true);          /* 家长端结算/上报时不弹提示、不撒彩带 */

  /* ======================================================================
     1. 门禁
     ====================================================================== */
  var GUARD = 'guard';
  var MAX_FAIL = 3, LOCK_MS = 60000, MIN_LEN = 4, MAX_LEN = 6;

  function hashPin(p) {
    var s = 'xyb::' + p + '::小悦饼', h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
    return (h >>> 0).toString(36);
  }
  function getGuard() { return A.Store.read(GUARD, null); }
  function setGuard(g) { A.Store.write(GUARD, g); }
  function clearGuard() { A.Store.del(GUARD); }

  var mode = 'unlock';        /* unlock = 输入密码 | setup = 首次设置密码 */
  var lockTimer = null;

  var elGate = document.getElementById('gate');
  var elPin = document.getElementById('gatePin');
  var elPin2 = document.getElementById('gatePin2');
  var elErr = document.getElementById('gateErr');
  var elSubmit = document.getElementById('gateSubmit');

  function paintGate() {
    var g = getGuard();
    var isSetup = !g;
    mode = isSetup ? 'setup' : 'unlock';

    document.getElementById('gateTitle').textContent = isSetup ? '设置家长密码' : '家长中心';
    document.getElementById('gateSub').innerHTML = isSetup
      ? '第一次使用，请设置一个 ' + MIN_LEN + '~' + MAX_LEN + ' 位数字密码。<br>' +
        '孩子看不到这个页面里的任何内容。'
      : '请输入家长密码（输入后按键盘回车）';
    elSubmit.textContent = isSetup ? '设置并进入' : '进入家长中心';
    elPin2.classList.toggle('hide', !isSetup);
    elPin.value = '';
    elPin2.value = '';
    elPin.placeholder = isSetup ? '设置密码' : '••••';
    document.getElementById('gateHint').classList.add('hide');
    elErr.textContent = '';
    elErr.className = 'gate-err';
    tickLock();
    if (lockTimer) clearInterval(lockTimer);
    lockTimer = setInterval(tickLock, 1000);
    setTimeout(function () { elPin.focus(); }, 60);
  }

  function tickLock() {
    var g = getGuard();
    var left = (g && g.lockUntil) ? Math.ceil((g.lockUntil - Date.now()) / 1000) : 0;
    if (left > 0) {
      elSubmit.disabled = true;
      elPin.disabled = true;
      elErr.className = 'gate-err on';
      elErr.textContent = '密码错误次数过多，请等 ' + left + ' 秒后再试';
    } else {
      elSubmit.disabled = false;
      elPin.disabled = false;
    }
  }

  function submitGate(e) {
    if (e) e.preventDefault();
    var g = getGuard();
    if (g && g.lockUntil > Date.now()) return;
    var pin = (elPin.value || '').trim();

    if (!/^\d+$/.test(pin) || pin.length < MIN_LEN || pin.length > MAX_LEN) {
      elErr.className = 'gate-err on';
      elErr.textContent = '请输入 ' + MIN_LEN + '~' + MAX_LEN + ' 位数字';
      return;
    }

    if (mode === 'setup') {
      if (elPin2.value.trim() !== pin) {
        elErr.className = 'gate-err on';
        elErr.textContent = '两次输入不一致，请重新输入';
        elPin2.value = '';
        return;
      }
      setGuard({ pin: hashPin(pin), setAt: Date.now(), fails: 0, lockUntil: 0 });
      A.toast('家长密码已设置 ✅');
      unlock();
      return;
    }

    if (hashPin(pin) === g.pin) {
      setGuard(Object.assign({}, g, { fails: 0, lockUntil: 0 }));
      unlock();
    } else {
      var fails = (g.fails || 0) + 1;
      var patch = { fails: fails };
      if (fails >= MAX_FAIL) { patch.lockUntil = Date.now() + LOCK_MS; patch.fails = 0; }
      setGuard(Object.assign({}, g, patch));
      elPin.value = '';
      elPin2.value = '';
      elErr.className = 'gate-err on';
      elErr.textContent = fails >= MAX_FAIL
        ? '错误次数过多，已锁定 60 秒'
        : '密码不对，还可以再试 ' + (MAX_FAIL - fails) + ' 次';
      tickLock();
    }
  }

  document.getElementById('gateForm').addEventListener('submit', submitGate);

  /* 数字框统一净化：全角→半角、去掉非数字、限长。
     为什么必须要这一步（2026-09-14 实测）：中文输入法在 iPad 上很容易打出全角数字"１２３４"，
     而输入框上只要有 pattern="[0-9]*"，浏览器原生校验就会**拦下提交事件** ——
     我们的 submitGate 根本不会执行，于是既不报错也不放行，页面看上去就是"点了没反应"。
     现在两处一起做：HTML 里不再写 pattern（防原生静默拦截），这里再把值洗干净。 */
  var PIN_IDS = { gatePin: 1, gatePin2: 1, pinNew: 1, pinNew2: 1 };
  function normalizePin(el) {
    var v = String(el.value || '')
      .replace(/[\uFF10-\uFF19]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[^0-9]/g, '');
    var max = parseInt(el.getAttribute('maxlength'), 10) || 0;
    if (max > 0 && v.length > max) v = v.slice(0, max);
    if (v !== el.value) el.value = v;
  }
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el && el.id && PIN_IDS[el.id]) normalizePin(el);
  });
  document.getElementById('gateForget').addEventListener('click', function () {
    var h = document.getElementById('gateHint');
    h.classList.toggle('hide');
    h.innerHTML = '<b>怎么重置密码</b><br>' +
      '在电脑浏览器按 <b>F12</b> 打开控制台（Console），粘贴执行：<br>' +
      '<code>localStorage.removeItem(\'xyb.v1.guard\')</code><br>' +
      '然后刷新本页，就会重新让你设置密码。<br>' +
      '<span class="warn">学习数据不受影响，不会丢。</span>';
  });

  function unlock() {
    sessionStart = Date.now();
    elGate.classList.add('hide');
    document.getElementById('app').classList.remove('hide');
    render();
    window.scrollTo({ top: 0 });
  }
  function lock() {
    elGate.classList.remove('hide');
    document.getElementById('app').classList.add('hide');
    A.closeSheet();
    paintGate();
  }

  /* 家长端闲置 15 分钟自动锁回，避免孩子趁家长走开接手 */
  var sessionStart = Date.now();
  document.addEventListener('click', function () { sessionStart = Date.now(); });
  setInterval(function () {
    if (elGate.classList.contains('hide') && Date.now() - sessionStart > 15 * 60000) lock();
  }, 30000);

  /* ======================================================================
     2. 渲染
     ====================================================================== */
  var mFilter = 'all';        /* all | pending | fixed */

  function render() {
    var s = A.stats();
    var p = DB.profile;

    document.getElementById('pgName').textContent = p.name;
    document.getElementById('pgAvatar').textContent = p.avatar;

    /* KPI */
    document.getElementById('pKpi').innerHTML =
      kpi('⏱', '今日学习', s.todayMin, '分钟', '目标 ' + (DB.settings.dailyGoal || 3) + ' 个内容') +
      kpi('📅', '本周学习', s.weekMin, '分钟', '最近 7 天累计') +
      kpi('📚', '已完成内容', s.doneCount, '个', '在线内容 ' + A.readyModules().length + ' 个') +
      kpi('🎯', '答题正确率', s.accuracy == null ? '—' : s.accuracy, s.accuracy == null ? '' : '%',
        s.asked ? '共 ' + s.asked + ' 题' : '暂无数据') +
      kpi('🔁', '错题待订正', s.mistakesPending, '道', '共记录 ' + s.mistakes + ' 道') +
      kpi('🔥', '连续天数', s.streak, '天', '保持得很好');

    /* 学习明细 */
    var rows = A.readyModules().map(function (m) {
      var pp = prog(m.id) || {};
      var logs = DB.log.filter(function (r) { return r.mid === m.id && r.durMs; });
      var ms = pp.timeMs || logs.reduce(function (a, r) { return a + r.durMs; }, 0);
      var acc = pp.asked ? Math.round((pp.right || 0) / pp.asked * 100) : null;
      var status = pp.status === 'done' ? '<span class="pill ok">已完成</span>'
        : (pp.visits ? '<span class="pill mid">学习中</span>' : '<span class="pill none">未开始</span>');
      var upct = pp.total ? Math.min(100, Math.round((pp.done || 0) / pp.total * 100)) : (pp.status === 'done' ? 100 : 0);
      var mw = DB.mistakes.filter(function (x) { return x.mid === m.id; }).length;
      return '<tr><td><b>' + esc(m.title) + '</b><div style="font-size:12px;color:var(--ink3)">' +
        esc(m.subject || '') + ' · ' + esc(m.grade || '') + '</div></td>' +
        '<td>' + status + '</td>' +
        '<td><div class="mini-bar"><i style="width:' + upct + '%"></i></div>' +
        '<div style="font-size:12px;color:var(--ink3);margin-top:3px">' + upct + '%</div></td>' +
        '<td>' + (ms ? Math.max(1, Math.round(ms / 60000)) + ' 分' : '—') + '</td>' +
        '<td>' + (acc == null ? '—' : acc + '%') + '</td>' +
        '<td>' + (mw ? '<span class="pill mid">' + mw + ' 道</span>' : '—') + '</td>' +
        '<td>' + (pp.lastAt ? A.fmtDate(new Date(pp.lastAt)) : '—') + '</td></tr>';
    }).join('');
    document.getElementById('pTable').innerHTML =
      '<table class="tb"><thead><tr><th>学习内容</th><th>状态</th><th>完成度</th><th>时长</th>' +
      '<th>正确率</th><th>错题</th><th>最近学习</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="7" style="text-align:center;color:var(--ink3)">暂无数据</td></tr>') + '</tbody></table>';

    /* 错题本 */
    var msAll = A.mistakes.list({});
    var msList = mFilter === 'pending' ? msAll.filter(function (m) { return !m.fixed; })
      : mFilter === 'fixed' ? msAll.filter(function (m) { return !!m.fixed; }) : msAll;
    document.getElementById('mstChips').innerHTML = [
      { k: 'all', t: '全部', n: msAll.length },
      { k: 'pending', t: '待订正', n: msAll.filter(function (m) { return !m.fixed; }).length },
      { k: 'fixed', t: '已订正', n: msAll.filter(function (m) { return !!m.fixed; }).length }
    ].map(function (c) {
      return '<button class="chip' + (mFilter === c.k ? ' on' : '') + '" data-mfilter="' + c.k + '">' +
        c.t + ' <span class="cnt">' + c.n + '</span></button>';
    }).join('');

    document.getElementById('mstBox').innerHTML = msList.length
      ? '<table class="tb"><thead><tr><th>题目</th><th>内容 / 知识点</th><th>孩子的答案</th>' +
        '<th>正确答案</th><th>错过</th><th>状态</th><th>操作</th></tr></thead><tbody>' +
        msList.map(function (m) {
          var mod = A.moduleById(m.mid);
          return '<tr><td><b>' + esc(m.q) + '</b></td>' +
            '<td>' + (mod ? esc(mod.title) : esc(m.mid)) +
            (m.tag ? '<div style="font-size:12px;color:var(--ink3)">' + esc(m.tag) + '</div>' : '') + '</td>' +
            '<td style="color:var(--coral)">' + esc(m.my || '—') + '</td>' +
            '<td style="color:var(--grass);font-weight:700">' + esc(m.answer || '—') + '</td>' +
            '<td>' + (m.times || 1) + ' 次</td>' +
            '<td>' + (m.fixed ? '<span class="pill ok">已订正</span>' : '<span class="pill mid">待订正</span>') + '</td>' +
            '<td><button class="btn sm ghost" data-mfix="' + esc(m.key) + '">' +
            (m.fixed ? '退回' : '标记已订正') + '</button> ' +
            '<button class="btn sm" data-mdel="' + esc(m.key) + '">移除</button></td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="empty" style="padding:30px 16px"><div class="e-ic">🎉</div><p>' +
        (mFilter === 'pending' ? '没有待订正的错题' : '错题本还是空的') + '</p></div>';

    /* 内容管理 */
    document.getElementById('pModules').innerHTML = CAT.modules.map(function (m) {
      var on = DB.hidden.indexOf(m.id) < 0;
      return '<div class="switch"><span style="font-size:22px">' + (m.emoji || '📘') + '</span>' +
        '<span class="txt"><b>' + esc(m.title) + '</b><span>' + esc(m.subject || '') + ' · ' +
        (m.status === 'planned' ? '规划中' : '已上线') + ' · ' + esc(m.url) + '</span></span>' +
        '<button class="sw' + (on ? ' on' : '') + '" data-toggle-mod="' + esc(m.id) + '" aria-label="显示或隐藏"></button></div>';
    }).join('');

    /* 设置 */
    document.getElementById('setName').value = DB.profile.name;
    document.getElementById('setGoal').value = DB.settings.dailyGoal;
    document.getElementById('setBreak').value = DB.settings.breakEvery;
    document.getElementById('avatarPick').innerHTML = AVATARS.map(function (a) {
      return '<button class="btn sm' + (DB.profile.avatar === a ? ' primary' : '') + '" data-avatar="' + a +
        '" style="font-size:19px;padding:6px 11px">' + a + '</button>';
    }).join('');
    document.getElementById('swBreak').className = 'sw' + (DB.settings.breakOn ? ' on' : '');
    document.getElementById('swSound').className = 'sw' + (DB.settings.soundOn ? ' on' : '');
    document.getElementById('guardState').textContent = getGuard() ? '已开启（4~6 位数字密码）' : '未开启';

    paintSync();      /* 同步状态跟着一起刷新 */
    paintHomework();  /* 作业录入区也跟着刷新（日期默认值、已录入列表） */
  }

  /* ======================================================================
     3. 事件
     ====================================================================== */
  document.addEventListener('click', function (e) {
    var t = e.target;

    var mf = t.closest('[data-mfilter]');
    if (mf) { mFilter = mf.getAttribute('data-mfilter'); render(); return; }

    var mfx = t.closest('[data-mfix]');
    if (mfx) {
      var k = mfx.getAttribute('data-mfix');
      var rec = A.mistakes.find(k);
      if (rec && rec.fixed) A.mistakes.unfix(k); else A.mistakes.fix(k);
      render(); A.toast(rec && rec.fixed ? '已退回待订正' : '已标记为订正');
      return;
    }
    var mdl = t.closest('[data-mdel]');
    if (mdl) {
      A.mistakes.remove(mdl.getAttribute('data-mdel'));
      render(); A.toast('已从错题本移除');
      return;
    }

    var dm = t.closest('[data-toggle-mod]');
    if (dm) {
      var id = dm.getAttribute('data-toggle-mod');
      var i = DB.hidden.indexOf(id);
      if (i < 0) DB.hidden.push(id); else DB.hidden.splice(i, 1);
      DB.save(); render();
      return;
    }

    var av = t.closest('[data-avatar]');
    if (av) { DB.profile.avatar = av.getAttribute('data-avatar'); DB.save(); render(); return; }

    var sw = t.closest('.sw');
    if (sw && sw.id === 'swBreak') { DB.settings.breakOn = !DB.settings.breakOn; DB.save(); render(); return; }
    if (sw && sw.id === 'swSound') { DB.settings.soundOn = !DB.settings.soundOn; DB.save(); render(); return; }

    /* ---- 作业：预览里删掉某一行（还没保存） ---- */
    var hwDelT = t.closest('[data-hw-del-task]');
    if (hwDelT) { hwDelTask(hwDelT.getAttribute('data-hw-del-task')); return; }

    /* ---- 家长待办打勾（疫苗打了、帽子名字写好了…） ---- */
    var hwPend = t.closest('[data-hw]');
    if (hwPend) {
      var hpp = hwPend.getAttribute('data-hw').split('|');
      A.homework.toggle(hpp[0], hpp[1], true);
      render();
      A.toast('已标记完成 👍');
      return;
    }

    var act = t.closest('[data-act]');
    if (act) {
      var a = act.getAttribute('data-act');
      if (a === 'export') A.exportData();
      if (a === 'reset') confirmReset();
      if (a === 'lock') lock();
      if (a === 'changePin') changePinSheet();
      if (a === 'clearFixed') {
        A.mistakes.list({ fixed: true }).forEach(function (m) { A.mistakes.remove(m.key); });
        render(); A.toast('已清理订正过的错题');
      }

      /* ---- 作业录入 ---- */
      if (a === 'hwParse') {
        var raw = elVal('hwRaw');
        if (!raw.trim()) { A.toast('先把老师发的作业粘进来'); return; }
        var draft = A.homework.parse(raw, elVal('hwDate') || todayStr());
        if (!draft || !draft.blocks.length) {
          A.toast('没解析出内容：确认里面有【数学】【语文】这样的板块标题');
          return;
        }
        hwDraft = draft;
        paintHwPreview();
        A.toast('解析出 ' + draft.blocks.length + ' 个板块，核对后保存');
      }
      if (a === 'hwSave') hwSaveDraft();
      if (a === 'hwCancel') { hwDraft = null; paintHwPreview(); }
      if (a === 'hwClearBox') { var rb2 = document.getElementById('hwRaw'); if (rb2) rb2.value = ''; }
      if (a === 'hwReparse') {
        var dRe = A.homework.day(act.getAttribute('data-date'));
        if (!dRe) return;
        var box2 = document.getElementById('hwRaw');
        if (box2) box2.value = dRe.raw || '';
        var dt2 = document.getElementById('hwDate');
        if (dt2) dt2.value = dRe.date;
        hwDraft = A.homework.parse(dRe.raw || '', dRe.date);
        paintHwPreview();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      if (a === 'hwDel') {
        var dDel = act.getAttribute('data-date');
        A.sheet('删除 ' + dDel + ' 的作业？', '孩子端会一起消失，老师原文也会删掉',
          '<div class="row"><button class="btn" data-close>我再想想</button>' +
          '<button class="btn sun" data-act="hwDelDo" data-date="' + dDel + '">确认删除</button></div>');
      }
      if (a === 'hwDelDo') {
        A.homework.remove(act.getAttribute('data-date'));
        A.closeSheet(); render(); A.toast('已删除这一天的作业');
      }

      /* ---- 多端同步 ---- */
      if (a === 'syncConnect') doConnect();
      if (a === 'syncModeCloud') activate(SYNC.status().url, pendingKey || A.cloudCfg().key, 'cloud');
      if (a === 'syncModeLocal') activate(SYNC.status().url, pendingKey || A.cloudCfg().key, 'local');
      if (a === 'syncNow') {
        if (!syncReady()) return;
        A.toast('正在同步…');
        SYNC.flush(true).then(function (r) {
          paintSync();
          if (r && r.ok) { render(); A.toast('已同步，记录点 rev ' + r.rev); }
          else if (r && r.error) A.toast('同步失败：' + r.error);
          else A.toast('同步未开启');
        });
      }
      if (a === 'syncOff') {
        if (!syncReady()) return;
        SYNC.disable().then(function () { paintSync(); A.toast('已关闭同步（本机记录保留）'); });
      }
      if (a === 'syncVersions') refreshVersions();
      if (a === 'syncRoll') rollbackConfirm(act.getAttribute('data-rev'));
      if (a === 'syncRollDo') {
        var rv = parseInt(act.getAttribute('data-rev'), 10) || 0;
        A.toast('正在回退…');
        SYNC.rollback(rv).then(function () {
          A.closeSheet(); render(); refreshVersions();
          A.toast('已回退到 rev ' + rv);
        }).catch(function (e) { A.toast('回退失败：' + (e.message || e)); });
      }
      if (a === 'syncResetCloud') resetCloudConfirm();
      if (a === 'syncResetDo') {
        A.toast('正在清空云端…');
        SYNC.resetCloud().then(function () {
          A.closeSheet(); render(); refreshVersions();
          A.toast('云端已清空，本机记录会作为新起点推上去');
        }).catch(function (e) { A.toast('清空失败：' + (e.message || e)); });
      }
      return;
    }
    if (t.hasAttribute('data-close')) A.closeSheet();
  });

  document.addEventListener('change', function (e) {
    var id = e.target.id;
    if (id === 'setName') { DB.profile.name = e.target.value.trim() || '小悦饼'; DB.save(); render(); A.toast('已保存'); }
    if (id === 'setGoal') { DB.settings.dailyGoal = Math.max(1, parseInt(e.target.value, 10) || 3); DB.save(); render(); }
    if (id === 'setBreak') { DB.settings.breakEvery = Math.max(5, parseInt(e.target.value, 10) || 20); DB.save(); }
    if (id === 'fileImport' && e.target.files && e.target.files[0]) A.importData(e.target.files[0], render);
  });

  function changePinSheet() {
    A.sheet('修改家长密码', '纯本地保存，忘记可在控制台重置',
      '<div class="field" style="margin-bottom:12px"><label>新密码（4~6 位数字）</label>' +
      '<input id="pinNew" type="password" inputmode="numeric" maxlength="6" style="max-width:200px"></div>' +
      '<div class="field" style="margin-bottom:16px"><label>再输一次</label>' +
      '<input id="pinNew2" type="password" inputmode="numeric" maxlength="6" style="max-width:200px"></div>' +
      '<div class="row"><button class="btn" data-close>取消</button>' +
      '<button class="btn primary" id="pinSave">保存</button></div>');
    /* sheet() 是同步插入 DOM 的，这里可以直接绑定，不需要 setTimeout */
    document.getElementById('pinSave').addEventListener('click', function () {
      var v1 = (document.getElementById('pinNew').value || '').trim();
      var v2 = (document.getElementById('pinNew2').value || '').trim();
      if (!/^\d{4,6}$/.test(v1)) { A.toast('请输入 4~6 位数字'); return; }
      if (v1 !== v2) { A.toast('两次输入不一致'); return; }
      setGuard({ pin: hashPin(v1), setAt: Date.now(), fails: 0, lockUntil: 0 });
      A.closeSheet(); render(); A.toast('家长密码已更新 ✅');
    });
  }

  function confirmReset() {
    A.sheet('清空所有学习数据', '⚠️ 此操作不可恢复，建议先导出备份',
      '<div class="row"><button class="btn" data-close>我再想想</button>' +
      '<button class="btn sun" id="doReset">确认清空</button></div>');
    document.getElementById('doReset').addEventListener('click', function () {
      A.clearAllData(); A.closeSheet(); render();
      A.toast('已清空');
    });
  }

  /* ======================================================================
     4. 作业（老师每天留的作业）
     ----------------------------------------------------------------------
     家长端负责"录进来"：粘贴老师原文 → 本地正则解析 → 预览可改 → 保存。
     为什么解析要留可改的一步：老师排版千奇百怪（1️⃣ / ① / 1. / 缩进），
     解析只能"尽力而为"，所以 ①老师和原文一起留档 ②预览里每个字都能改。
     孩子端看到的是 text（一句短话），full（原文那句）留在家长端。
     ====================================================================== */
  var hwDraft = null;

  function todayStr() { return A.fmtDate(new Date()); }
  function elVal(id) { var e = document.getElementById(id); return e ? e.value : ''; }

  function paintHomework() {
    var dEl = document.getElementById('hwDate');
    if (dEl && !dEl.value) dEl.value = todayStr();
    if (hwDraft) paintHwPreview();

    var box = document.getElementById('hwDays');
    if (!box) return;
    var days = A.homework.days();
    var pending = A.homework.pending(todayStr());

    var html = '';
    if (pending.length) {
      html += '<div class="hw-parent"><b>👨‍👩‍👧 要爸爸妈妈做的事</b><ul>' +
        pending.map(function (p) {
          return '<li>' + esc(p.task.text) +
            (p.task.due ? '<span style="color:var(--ink3)">（' +
              p.task.due.slice(5).replace('-', '/') + ' 前）</span>' : '') +
            ' <button class="btn sm ghost" data-hw="' + p.date + '|' + p.task.id + '">好了</button></li>';
        }).join('') + '</ul></div>';
    }
    if (days.length) {
      html += '<div class="sec-head" style="margin:16px 0 8px"><h2>已录入的作业</h2></div>';
      html += days.map(function (d) {
        var s = A.homework.stats(d.date);
        return '<div class="hw-hist-item">' +
          '<span class="hw-hist-date">' + d.date.slice(5).replace('-', '/') + '</span>' +
          '<span class="hw-hist-sum">' + s.total + ' 项 · 孩子做完 ' + s.done + ' 项' +
          (s.parentLeft ? ' · 家长待办 ' + s.parentLeft + ' 项' : '') + '</span>' +
          '<span style="margin-left:auto;display:flex;gap:6px">' +
          '<button class="btn sm ghost" data-act="hwReparse" data-date="' + d.date + '">重新解析</button>' +
          '<button class="btn sm" data-act="hwDel" data-date="' + d.date + '">删除</button></span></div>';
      }).join('');
    } else {
      html += '<p class="ph" style="margin-top:14px">还没有录入过作业。</p>';
    }
    box.innerHTML = html;
  }

  function paintHwPreview() {
    var box = document.getElementById('hwPreview');
    if (!box) return;
    if (!hwDraft) { box.innerHTML = ''; return; }
    var nTask = 0;
    (hwDraft.blocks || []).forEach(function (b) { nTask += (b.tasks || []).length; });
    var html = '<div class="hw-preview">' +
      '<div class="hw-preview-head"><b>解析结果</b>' +
      '<span>' + hwDraft.date + ' · ' + hwDraft.blocks.length + ' 个板块 · ' + nTask +
      ' 条任务（文字可以直接改，"给家长"勾上就不显示给孩子）</span></div>';
    (hwDraft.blocks || []).forEach(function (b, bi) {
      html += '<div class="hw-preview-blk"><b>' + (b.emoji || '📌') + ' ' + esc(b.subject) + '</b>';
      if (b.learned) html += '<div class="hw-learned">今天学了：' + esc(b.learned) + '</div>';
      (b.tasks || []).forEach(function (t, ti) {
        html += '<div class="hw-row">' +
          '<span class="hw-row-ic">' + t.icon + '</span>' +
          '<span class="hw-row-verb">' + esc(t.verb) + '</span>' +
          '<input class="hw-row-txt" data-hw-edit="' + bi + '-' + ti + '" value="' + esc(t.text) + '">' +
          '<label class="hw-row-p"><input type="checkbox" data-hw-parent="' + bi + '-' + ti + '"' +
            ((b.cls || t.forParent) ? ' checked' : '') + '> 给家长</label>' +
          '<button class="btn sm ghost" data-hw-del-task="' + bi + '-' + ti + '">删</button>' +
          '</div>';
      });
      html += '</div>';
    });
    html += '<div class="row" style="margin-top:12px">' +
      '<button class="btn primary" data-act="hwSave">💾 保存，孩子端立刻可见</button>' +
      '<button class="btn ghost" data-act="hwCancel">取消</button></div></div>';
    box.innerHTML = html;
  }

  function hwSaveDraft() {
    if (!hwDraft) return;
    /* 把预览里的修改写回草稿；被"删"掉的行已经不在 DOM 里，跳过即可 */
    (hwDraft.blocks || []).forEach(function (b, bi) {
      var keep = [];
      (b.tasks || []).forEach(function (t, ti) {
        var e = document.querySelector('[data-hw-edit="' + bi + '-' + ti + '"]');
        if (!e) return;
        var txt = String(e.value || '').trim();
        if (txt) t.text = txt;
        var p = document.querySelector('[data-hw-parent="' + bi + '-' + ti + '"]');
        t.forParent = !!(p && p.checked);
        keep.push(t);
      });
      b.tasks = keep;
    });
    hwDraft.blocks = hwDraft.blocks.filter(function (b) {
      return (b.tasks && b.tasks.length) || b.learned;
    });
    if (!hwDraft.blocks.length) { A.toast('解析出来的内容都被删掉了，没有可保存的东西'); return; }
    A.homework.upsert(hwDraft);
    hwDraft = null;
    paintHwPreview();
    render();
    A.toast('已保存 ✅ 孩子端刷新就能看到');
  }

  function hwDelTask(key) {
    var p = String(key).split('-'), bi = Number(p[0]), ti = Number(p[1]);
    if (hwDraft && hwDraft.blocks[bi] && hwDraft.blocks[bi].tasks) {
      hwDraft.blocks[bi].tasks.splice(ti, 1);
    }
    paintHwPreview();
  }

  /* ======================================================================
     5. 多端同步（可选，默认关闭；关着的时候这一段全都不生效）
     ----------------------------------------------------------------------
     服务端只追加事件、按 id 去重、分配 rev，各端拿同一批事件重算状态，
     于是多端天然收敛 —— 详见 docs/服务端数据同步设计.md
     ====================================================================== */
  var SYNC = window.XYBSync;
  var pendingKey = '';        /* 撞上"两边都有数据"时，暂存口令等家长选 */

  function agoText(ts) {
    var d = Date.now() - ts;
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    return Math.floor(d / 86400000) + ' 天前';
  }

  function syncReady() {
    if (SYNC) return true;
    A.toast('同步模块没加载成功，请刷新页面');
    return false;
  }

  function paintSync() {
    var elState = document.getElementById('syncState');
    var elDetail = document.getElementById('syncDetail');
    var elUrl = document.getElementById('syncUrl');
    var elKey = document.getElementById('syncKey');
    if (!elState) return;

    if (!SYNC) {
      elState.className = 'sync-state bad';
      elState.textContent = '模块未加载';
      return;
    }
    var st = SYNC.status();
    if (elUrl && document.activeElement !== elUrl) elUrl.value = st.url || SYNC.DEFAULT_URL;
    if (elKey && document.activeElement !== elKey) {
      elKey.placeholder = st.hasKey ? '••••（已保存，改口令就重输）' : '首次连接时设置';
    }

    var cls = 'sync-state', txt;
    if (!st.enabled) { txt = '未开启'; }
    else if (st.lastError) { cls += ' bad'; txt = '⚠️ 同步失败'; }
    else if (st.busy) { cls += ' warn'; txt = '☁️ 正在同步…'; }
    else if (st.pending) { cls += ' warn'; txt = '☁️ ' + st.pending + ' 条待同步'; }
    else if (st.lastSyncAt) { cls += ' ok'; txt = '☁️ 正常'; }
    else { cls += ' warn'; txt = '☁️ 等待首次同步'; }
    elState.className = cls;
    elState.textContent = txt;

    if (!st.enabled) {
      elDetail.textContent = '开启后 iPad、电脑共用同一份学习记录；不开就还是纯本地。';
      return;
    }
    elDetail.innerHTML =
      '记录点 <b>rev ' + st.rev + '</b>（第 ' + st.gen + ' 代）· 本机 <b>' + esc(st.deviceId) + '</b>' +
      ' · ' + (st.lastSyncAt ? '上次同步 <b>' + agoText(st.lastSyncAt) + '</b>' : '还没同步成功') +
      (st.pending ? ' · <b>' + st.pending + '</b> 条待推送' : '') +
      (st.lastError ? '<br>最近一次错误：<b>' + esc(st.lastError) + '</b>' : '');
  }

  /* 连接：验口令（服务端还没设就顺手设一次），然后按情况决定要不要问"以哪边为准" */
  function doConnect() {
    if (!syncReady()) return;
    var url = (document.getElementById('syncUrl').value || '').trim();
    var key = (document.getElementById('syncKey').value || '').trim() || (SYNC.status().hasKey ? '' : '');
    if (!key) {
      var cfgKey = A.cloudCfg().key || '';
      if (!cfgKey) { A.toast('请先填一个 4 位以上的家庭口令'); return; }
      key = cfgKey;          /* 已经连过：留空表示沿用原口令 */
    }
    A.toast('正在连接…');
    SYNC.connect(url, key).then(function (r) {
      if (r.needChoice) {
        pendingKey = key;
        A.sheet('两边都有数据，以哪边为准？',
          '服务器上已有 ' + (r.serverRev || 0) + ' 个记录点，这台设备上也有学习记录。',
          '<div class="sync-meta">「以云端为准」：本机记录被云端覆盖（建议先导出备份）。<br>' +
          '「以本机为准」：把本机当前进度推上去作为新起点，云端历史仍留在快照里。</div>' +
          '<div class="row" style="margin-top:16px">' +
          '<button class="btn" data-act="syncModeCloud">以云端为准</button> ' +
          '<button class="btn primary" data-act="syncModeLocal">以本机为准</button> ' +
          '<button class="btn ghost" data-close>取消</button></div>');
        return;
      }
      if (r.setKey) A.toast('已在服务器上设好家庭口令');
      activate(r.u, key, r.serverRev > 0 ? 'cloud' : 'local');
    }).catch(function (e) {
      paintSync();
      A.toast('连接失败：' + (e.message || e));
    });
  }

  function activate(url, key, mode) {
    A.toast('正在对齐记录…');
    SYNC.activate(url, key, mode).then(function (r) {
      pendingKey = '';
      A.closeSheet();
      render();
      A.toast(r.mode === 'cloud' ? '已按云端记录对齐 ✅'
        : r.mode === 'seed' ? '同步已开启，本机作为起点 ✅' : '已开启同步 ✅');
    }).catch(function (e) {
      paintSync();
      A.toast('开启失败：' + (e.message || e));
    });
  }

  function refreshVersions() {
    var box = document.getElementById('syncVersions');
    if (!SYNC || !SYNC.status().enabled) {
      box.textContent = '还没开启同步。开启后这里会列出每一次记录点，可以回退到任意一次。';
      return;
    }
    box.textContent = '读取中…';
    SYNC.versions().then(function (list) {
      if (!list.length) {
        box.textContent = '还没有快照。每次回滚或清空云端之前都会自动留一份，到那时才会出现。';
        return;
      }
      box.innerHTML = list.map(function (v) {
        var m = /^g(\d+)-r(\d+)-/.exec(v.file || '');
        var action = ((v.file || '').split('-').pop() || '').replace('.jsonl', '');
        var label = action === 'rollback' ? '回滚前' : action === 'reset' ? '清空前' : esc(action);
        return '<div class="row" style="align-items:center;gap:10px;margin-top:8px;flex-wrap:wrap">' +
          '<span style="min-width:62px"><b>rev ' + (m ? m[2] : '?') + '</b></span>' +
          '<span style="min-width:146px">' + esc(v.ts || '') + '</span>' +
          '<span style="color:var(--ink3)">' + label + ' · ' + (Math.round((v.bytes || 0) / 102.4) / 10) + ' KB</span>' +
          (m ? '<button class="btn sm ghost" data-act="syncRoll" data-rev="' + m[2] + '">回退到这里</button>' : '') +
          '</div>';
      }).join('');
    }).catch(function (e) {
      box.textContent = '读取失败：' + (e.message || e);
    });
  }

  function rollbackConfirm(rev) {
    A.sheet('回退到 rev ' + rev + '？',
      '回退会把云端事件日志截断到这个记录点，所有设备重新对齐一次。',
      '<div class="sync-meta">回退前的当前状态会自动留一份快照，需要时可以再找回来。<br>' +
      '<span class="warn">回退之后在本机产生的、还没推上去的改动会保留在本机队列里。</span></div>' +
      '<div class="row" style="margin-top:16px">' +
      '<button class="btn" data-close>我再想想</button> ' +
      '<button class="btn sun" data-act="syncRollDo" data-rev="' + rev + '">确认回退</button></div>');
  }

  function resetCloudConfirm() {
    A.sheet('清空云端记录？',
      '⚠️ 云端事件会被清空（本机的学习记录不受影响，会作为新起点重新推上去）',
      '<div class="sync-meta">清空前会自动留一份快照。如果你是想"以云端为准"对齐别的设备，' +
      '请不要用这个功能。</div>' +
      '<div class="row" style="margin-top:16px">' +
      '<button class="btn" data-close>我再想想</button> ' +
      '<button class="btn sun" data-act="syncResetDo">确认清空云端</button></div>');
  }

  /* 家长解锁之后再启动同步层：同步回来重画一遍，避免看到旧数据 */
  function startSync() {
    if (!SYNC) return;
    SYNC.onChange(function (r) {
      paintSync();
      if (r && r.ok !== false) render();
    });
    paintSync();
    var p = SYNC.boot();
    if (p && p.then) p.then(function (r) { paintSync(); if (r && !r.skipped) render(); });
  }

  /* ======================================================================
     5. 启动
     ====================================================================== */
  A.bootCore();          /* 结算时长 / 消费模块上报（静默） */
  startSync();           /* 没开同步时立刻返回；开了就顺手对齐一次再渲染 */
  paintGate();
})();
