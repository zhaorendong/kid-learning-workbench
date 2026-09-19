/* ==========================================================================
   小悦饼学习工作台 · 孩子端 (student.js)
   --------------------------------------------------------------------------
   由 index.html 加载。只负责孩子看得到的界面：
     首页（今日任务 / 学习路径 / 推荐）/ 全部课程 / 错题本 / 我的成就

   注意：家长中心不在这里 —— 它是独立的 parent.html，
   本页不包含任何家长设置的渲染逻辑，孩子从这个页面碰不到家长数据。
   ========================================================================== */
(function () {
  'use strict';

  var A = window.XYBApp;
  var DB = A.DB, CAT = A.CAT, AVATARS = A.AVATARS;
  var esc = A.esc, prog = A.prog, kpi = A.kpi;

  var state = { view: 'home', subject: '全部', q: '' };

  /* ======================================================================
     渲染
     ====================================================================== */
  function render() {
    document.getElementById('avatarBtn').textContent = DB.profile.avatar;
    document.getElementById('greetName').textContent = DB.profile.name;
    var hour = new Date().getHours();
    var hello = hour < 6 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
    document.getElementById('greetSub').textContent = hello + '！今天想学点什么？';

    var s = A.stats();
    document.getElementById('stStars').innerHTML = '<b>' + s.stars + '</b><span>颗星星</span>';
    document.getElementById('stStreak').innerHTML = '<b>' + s.streak + '</b><span>连续天数</span>';
    document.getElementById('stTime').innerHTML = '<b>' + s.weekMin + '</b><span>本周分钟</span>';

    document.getElementById('todayBox').classList.toggle('hide', state.view !== 'home');

    ['home', 'homework', 'courses', 'review', 'badges'].forEach(function (v) {
      var el = document.getElementById('view-' + v);
      if (el) el.classList.toggle('hide', v !== state.view);
      ['nav-' + v, 'tab-' + v].forEach(function (id) {
        var b = document.getElementById(id);
        if (b) b.classList.toggle('on', v === state.view);
      });
    });

    /* 顶部导航与底部 Tab 上的错题角标（同一份数字，两个节点） */
    var pend = A.mistakes.stats().pending;
    ['reviewDot', 'reviewDot2'].forEach(function (bid) {
      var badge = document.getElementById(bid);
      if (!badge) return;
      badge.textContent = pend > 9 ? '9+' : pend;
      badge.classList.toggle('hide', pend === 0);
    });

    /* 作业角标：还有几项没做完（同样两个节点一起更新） */
    var hws = A.homework.stats();
    ['hwDot', 'hwDot2'].forEach(function (bid) {
      var badge = document.getElementById(bid);
      if (!badge) return;
      badge.textContent = hws.left > 9 ? '9+' : hws.left;
      badge.classList.toggle('hide', hws.left === 0);
    });

    if (state.view === 'home') { renderHome(s); renderHwHome(); }
    if (state.view === 'homework') renderHomework();
    if (state.view === 'courses') renderCourses();
    if (state.view === 'review') renderReview();
    if (state.view === 'badges') renderBadges(s);
  }

  /* ---------------- 首页 ---------------- */
  function renderHome(s) {
    var goal = DB.settings.dailyGoal || 3;
    var pct = Math.min(100, Math.round(s.todayDone / goal * 100));
    var C = 2 * Math.PI * 34;
    document.getElementById('todayRing').innerHTML =
      '<svg width="82" height="82"><circle cx="41" cy="41" r="34" fill="none" stroke="#e9f0fa" stroke-width="9"/>' +
      '<circle cx="41" cy="41" r="34" fill="none" stroke="url(#rg)" stroke-width="9" stroke-linecap="round" ' +
      'stroke-dasharray="' + C + '" stroke-dashoffset="' + (C * (1 - pct / 100)) + '"/>' +
      '<defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#4f8ef7"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs></svg>' +
      '<div class="ring-txt">' + s.todayDone + '/' + goal + '<small>今日目标</small></div>';

    document.getElementById('todayTitle').textContent =
      s.todayDone >= goal ? '今天的目标完成啦！🎉' : '今天还有 ' + (goal - s.todayDone) + ' 个小任务';
    document.getElementById('todayDesc').textContent =
      s.todayDone >= goal ? '太棒了，可以自由探索喜欢的内容～'
        : '每次 10~20 分钟就够，学完记得休息眼睛哦。';

    /* 继续学习：优先未完成的、最近打开的 */
    var pick = null, cands = A.readyModules();
    for (var i = 0; i < cands.length; i++) {
      var p = prog(cands[i].id);
      if (p && p.status === 'doing') { pick = cands[i]; break; }
    }
    if (!pick) {
      for (var j = 0; j < cands.length; j++) {
        if (!prog(cands[j].id)) { pick = cands[j]; break; }
      }
    }
    if (!pick && cands.length) pick = cands[0];

    var box = document.getElementById('continueBox');
    var btns = [];
    if (pick) {
      btns.push('<button class="btn primary" data-go="' + esc(pick.id) + '">' +
        (prog(pick.id) ? '▶ 继续学：' : '▶ 开始学：') + esc(pick.title) + '</button>');
      if (cands.length > 1) btns.push('<button class="btn ghost" data-view="courses">看看其他内容</button>');
    } else {
      btns.push('<span style="color:var(--ink3)">还没有上线的学习内容，去家长端添加吧。</span>');
    }
    if (s.mistakesPending > 0) {
      btns.push('<button class="btn sun" data-view="review">🔁 还有 ' + s.mistakesPending + ' 道错题待订正</button>');
    }
    box.innerHTML = btns.join('');

    renderPaths();

    var rec = A.readyModules().filter(function (m) { return m.featured; });
    rec = (rec.length ? rec : A.readyModules()).slice(0, 6);
    document.getElementById('homeGrid').innerHTML = rec.map(cardHTML).join('') || emptyHTML();
    document.getElementById('homeGrid').parentNode.querySelector('.sec-head .sub').textContent =
      '共 ' + A.readyModules().length + ' 个内容 · 规划中 ' +
      A.visibleModules().filter(function (m) { return m.status === 'planned'; }).length + ' 个';

    var got = A.earnedIds();
    document.getElementById('homeBadges').innerHTML = A.ACHIEVEMENTS.slice(0, 6).map(function (a) {
      var on = DB.achievements[a.id];
      return '<div class="badge-card' + (on ? '' : ' locked') + '">' +
        '<div class="ic">' + a.ic + '</div><b>' + esc(a.name) + '</b>' +
        '<span>' + (on ? '已获得' : esc(a.desc)) + '</span></div>';
    }).join('');
    document.getElementById('homeBadgeCnt').textContent = got.length + ' / ' + A.ACHIEVEMENTS.length;
  }

  function renderPaths() {
    var groups = {}, order = [];
    A.readyModules().forEach(function (m) {
      var k = m.path || '其他';
      if (!groups[k]) { groups[k] = []; order.push(k); }
      groups[k].push(m);
    });
    order.forEach(function (k) { groups[k].sort(function (a, b) { return (a.pathOrder || 99) - (b.pathOrder || 99); }); });

    document.getElementById('pathBox').innerHTML = order.map(function (k) {
      var list = groups[k];
      var done = list.filter(function (m) { var p = prog(m.id); return p && p.status === 'done'; }).length;
      var pct = Math.round(done / list.length * 100);
      var sb = A.subjectMeta(list[0].subject);
      return '<div class="path">' +
        '<div class="path-head"><span style="font-size:20px">' + sb.emoji + '</span><b>' + esc(k) + '</b>' +
        '<span class="pct">' + done + '/' + list.length + ' 已掌握 · ' + pct + '%</span></div>' +
        '<div class="pbar"><i style="width:' + pct + '%"></i></div>' +
        '<div class="steps">' + list.map(function (m, i) {
          var p = prog(m.id);
          var cls = p && p.status === 'done' ? 'ok' : (i > done ? 'lock' : '');
          return '<button class="step ' + cls + '" data-go="' + esc(m.id) + '">' +
            '<div class="dot">' + (p && p.status === 'done' ? '✅' : (m.emoji || '📘')) + '</div>' +
            '<div class="nm">' + esc(m.title) + '</div>' +
            '<div class="mt">' + (m.minutes || 15) + ' 分钟</div></button>';
        }).join('') + '</div></div>';
    }).join('') || '<div class="empty"><div class="e-ic">🗺️</div><p>还没有形成学习路径</p></div>';
  }

  /* ---------------- 卡片 ---------------- */
  function cardHTML(m) {
    var p = prog(m.id);
    var done = p && p.status === 'done';
    var planned = m.status === 'planned';
    var tm = A.typeMeta(m.type);
    var pct = 0;
    if (p && p.total) pct = Math.min(100, Math.round((p.done || 0) / p.total * 100));
    else if (done) pct = 100;
    var stars = p && p.stars ? p.stars : 0;
    return '<article class="mcard' + (planned ? ' planned' : '') + (done ? ' done' : '') + '" ' +
      'data-go="' + esc(m.id) + '" style="--c:' + esc(m.color || '#4f8ef7') + '">' +
      '<div class="mcard-cover" style="background:linear-gradient(135deg,' + esc(m.color || '#4f8ef7') + 'cc,' + esc(m.color || '#4f8ef7') + ')">' +
      (m.emoji || '📘') +
      '<span class="badge">' + (done ? '✅ 已完成' : tm.emoji + ' ' + tm.label) + '</span>' +
      (m.grade ? '<span class="grade">' + esc(m.grade) + '</span>' : '') +
      (pct > 0 && !planned ? '<span class="star-line"><i style="width:' + pct + '%"></i></span>' : '') +
      '</div>' +
      '<div class="mcard-body">' +
      '<h3>' + esc(m.title) + '</h3>' +
      '<p class="st">' + esc(m.subtitle || '') + '</p>' +
      '<p class="ds">' + esc(m.desc || '') + '</p>' +
      '<div class="mcard-meta">' +
      (m.tags || []).slice(0, 2).map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') +
      '<span class="mins">⏱ ' + (m.minutes || 15) + ' 分</span>' +
      (planned ? '' : '<span class="stars">' +
        [1, 2, 3].map(function (n) { return '<i class="' + (stars >= n ? 'on' : '') + '">⭐</i>'; }).join('') +
        '</span>') +
      '</div></div>' +
      (m.progress === 'manual' && !planned
        ? '<button class="mark' + (done ? ' on' : '') + '" data-mark="' + esc(m.id) + '">' +
          (done ? '✓ 已学完（点击撤销）' : '标记为已学完') + '</button>' : '') +
      (planned ? '<div class="soon">🚧 规划中 · 等待内容生成</div>' : '') +
      '</article>';
  }
  function emptyHTML() {
    return '<div class="empty" style="grid-column:1/-1"><div class="e-ic">🔍</div>' +
      '<p>没有找到匹配的内容</p><button class="btn ghost" data-view="home">回到首页</button></div>';
  }

  /* ---------------- 全部课程 ---------------- */
  function renderCourses() {
    var subs = ['全部'].concat((CAT.subjects || []).map(function (s) { return s.name; }));
    document.getElementById('chips').innerHTML = subs.map(function (nm) {
      var cnt = nm === '全部' ? A.visibleModules().length
        : A.visibleModules().filter(function (m) { return m.subject === nm; }).length;
      var sm = nm === '全部' ? { emoji: '🌈' } : A.subjectMeta(nm);
      return '<button class="chip' + (state.subject === nm ? ' on' : '') + '" data-sub="' + esc(nm) + '">' +
        sm.emoji + ' ' + esc(nm) + ' <span class="cnt">' + cnt + '</span></button>';
    }).join('');

    var list = A.visibleModules().filter(function (m) {
      if (state.subject !== '全部' && m.subject !== state.subject) return false;
      if (state.q) {
        var hay = [m.title, m.subtitle, m.desc, m.subject, m.grade, (m.tags || []).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(state.q.toLowerCase()) < 0) return false;
      }
      return true;
    });
    list.sort(function (a, b) {
      var av = a.status === 'planned' ? 1 : 0, bv = b.status === 'planned' ? 1 : 0;
      return av - bv;
    });
    document.getElementById('allGrid').innerHTML = list.map(cardHTML).join('') || emptyHTML();
    document.getElementById('courseCnt').textContent = '显示 ' + list.length + ' 个';
  }

  /* ---------------- 错题本 ---------------- */
  function renderReview() {
    var ms = A.mistakes.stats();
    document.getElementById('reviewKpi').innerHTML =
      kpi('📌', '待订正', ms.pending, '道', '做错了还没弄懂的题') +
      kpi('✅', '已订正', ms.fixed, '道', '累计订正 ' + A.stats().fixedMistakes + ' 道') +
      kpi('📚', '涉及内容', ms.moduleCount, '个', '跨模块自动汇总');

    var list = A.mistakes.list({});
    if (!list.length) {
      document.getElementById('reviewBox').innerHTML =
        '<div class="empty"><div class="e-ic">🎉</div><p>错题本是空的，太棒了！</p>' +
        '<p style="font-size:14px">做练习时答错的题会自动收到这里，隔天回来看一眼就好。</p>' +
        '<button class="btn ghost" data-view="courses">去练一练</button></div>';
      return;
    }
    document.getElementById('reviewBox').innerHTML = list.map(function (m) {
      var mod = A.moduleById(m.mid);
      return '<article class="mfcard' + (m.fixed ? ' fixed' : '') + '">' +
        '<div class="mf-top">' +
        '<span class="mf-mod">' + (mod ? (mod.emoji + ' ' + esc(mod.title)) : esc(m.mid)) + '</span>' +
        (m.tag ? '<span class="tag">' + esc(m.tag) + '</span>' : '') +
        '<span class="mf-times">错过 ' + (m.times || 1) + ' 次</span>' +
        '<span class="pill ' + (m.fixed ? 'ok' : 'mid') + '">' + (m.fixed ? '已订正' : '待订正') + '</span>' +
        '</div>' +
        '<div class="mf-q">' + esc(m.q) + '</div>' +
        '<div class="mf-ans hidden" id="ans-' + encodeURIComponent(m.key) + '">' +
        '<span>我写的：<b>' + esc(m.my || '—') + '</b></span>' +
        '<span>正确答案：<b class="ok">' + esc(m.answer || '—') + '</b></span></div>' +
        '<div class="mf-acts">' +
        '<button class="btn sm ghost" data-peek="' + esc(m.key) + '">看看答案</button>' +
        (m.fixed
          ? '<button class="btn sm" data-unfix="' + esc(m.key) + '">还没懂，重新练</button>'
          : '<button class="btn sm sun" data-fix="' + esc(m.key) + '">👍 我想出来了</button>') +
        '</div></article>';
    }).join('');
  }

  /* ---------------- 成就 ---------------- */
  function renderBadges(s) {
    document.getElementById('badgeGrid').innerHTML = A.ACHIEVEMENTS.map(function (a) {
      var on = DB.achievements[a.id];
      return '<div class="badge-card' + (on ? '' : ' locked') + '">' +
        '<div class="ic">' + (on ? a.ic : '🔒') + '</div><b>' + esc(a.name) + '</b>' +
        '<span>' + esc(a.desc) + '</span>' +
        (on ? '<div style="font-size:11.5px;color:var(--grass);margin-top:4px;font-weight:700">已获得</div>' : '') +
        '</div>';
    }).join('');
    document.getElementById('badgeKpi').innerHTML =
      kpi('🌟', '星星总数', s.stars, '颗', '完成内容 +3') +
      kpi('🔥', '连续学习', s.streak, '天', '每天打开工作台') +
      kpi('⏳', '累计时长', s.totalMin, '分钟', '含所有模块') +
      kpi('🎯', '答题正确率', s.accuracy == null ? '—' : s.accuracy, s.accuracy == null ? '' : '%', '来自模块上报') +
      kpi('📚', '已完成', s.doneCount, '个', '共 ' + A.readyModules().length + ' 个内容');
  }

  /* ======================================================================
     作业（老师每天留的作业）
     ----------------------------------------------------------------------
     孩子端只显示"该我做的事"：班级通知那类（疫苗、带书、写姓名）是给家长的，
     这里不显示，只提示一句"还有 N 件要提醒爸爸妈妈"。
     每个任务 = 图标 + 动词 + 一句短话（+ 页码小字），点一下就打勾。
     ====================================================================== */
  var hwPick = '';        /* 翻看以前的作业时，当前展开哪一天 */

  function hwTaskHTML(date, t) {
    return '<button class="hwt' + (t.doneAt ? ' done' : '') + '" data-hw="' + date + '|' + t.id + '">' +
      '<span class="hwt-ic">' + t.icon + '</span>' +
      '<span class="hwt-body">' +
        '<span class="hwt-verb">' + esc(t.verb) + '</span>' +
        '<span class="hwt-txt">' + esc(t.text) + '</span>' +
        (t.ref ? '<span class="hwt-ref">📖 ' + esc(t.ref) + '</span>' : '') +
      '</span>' +
      '<span class="hwt-tick">' + (t.doneAt ? '✓' : '') + '</span>' +
      '</button>';
  }
  function hwBlocksHTML(day) {
    var out = '';
    (day.blocks || []).forEach(function (b) {
      if (b.cls) return;                        /* 班级通知 = 家长的事，孩子端不显示 */
      var tasks = (b.tasks || []).filter(function (t) { return !t.forParent; });
      if (!tasks.length) return;
      out += '<div class="hw-sub"><span>' + (b.emoji || '📌') + ' ' + esc(b.subject) + '</span>' +
        (b.learned ? '<span class="hw-learned">今天学了：' + esc(b.learned) + '</span>' : '') + '</div>';
      tasks.forEach(function (t) { out += hwTaskHTML(day.date, t); });
    });
    return out;
  }
  function hwEmptyHTML(what) {
    return '<div class="hw-empty"><span class="ic">🎈</span><p>' + what + '</p></div>';
  }
  function hwDayHead(day, s, extra) {
    var pct = s.total ? Math.round(s.done / s.total * 100) : 100;
    return '<div class="hw-day-head"><b>📅 ' + day.date.slice(5).replace('-', ' 月 ') + ' 日</b>' +
      (extra || '') +
      '<span class="hw-pct">' + s.done + ' / ' + s.total + (s.total && !s.left ? ' ✅' : '') + '</span></div>' +
      '<div class="hw-prog"><i style="width:' + pct + '%"></i></div>';
  }

  /* 首页那张卡：今天还有几项 + 直接把没做完的前两项摆出来打勾 */
  function renderHwHome() {
    var box = document.getElementById('hwHomeBox');
    if (!box) return;
    var sub = document.getElementById('hwHomeSub');
    var st = A.homework.stats();
    if (!st.has) {
      if (sub) sub.textContent = '';
      box.innerHTML = hwEmptyHTML('今天还没有作业记录～ 家长在「家长中心 → 作业」里把老师发的通知粘进来就有了。');
      return;
    }
    var day = st.day;
    if (sub) sub.textContent = st.left ? '还有 ' + st.left + ' 项没做完' : '都做完啦，真棒！';

    var html = '<div class="hw-day">' + hwDayHead(day, st);
    var shown = 0;
    (day.blocks || []).forEach(function (b) {
      if (b.cls) return;
      (b.tasks || []).forEach(function (t) {
        if (t.forParent || t.doneAt || shown >= 2) return;
        html += hwTaskHTML(day.date, t);
        shown++;
      });
    });
    if (shown === 0) {
      html += '<div style="text-align:center;padding:10px 0 14px;color:var(--grass);font-weight:700">' +
        '🎉 今天的作业都做完啦</div>';
    }
    html += '<div class="row" style="justify-content:center;margin:6px 0 12px">' +
      '<button class="btn sm ghost" data-view="homework">看全部作业 →</button></div></div>';
    box.innerHTML = html;
  }

  /* 作业视图：最新一天完整展开，以前的作业折叠成一行可点开 */
  function renderHomework() {
    var box = document.getElementById('hwBox');
    if (!box) return;
    var days = A.homework.days();
    var sub = document.getElementById('hwSub');
    var hist = document.getElementById('hwHistory');
    var st = A.homework.stats();
    if (sub) {
      sub.textContent = st.has ? (st.left ? '今天还有 ' + st.left + ' 项没做完' : '今天的都做完啦') : '';
    }
    if (!days.length) {
      box.innerHTML = hwEmptyHTML('还没有作业～ 家长在「家长中心 → 作业」里把老师发的通知粘进来就有了。');
      if (hist) hist.innerHTML = '';
      return;
    }
    if (hwPick && !days.some(function (d) { return d.date === hwPick; })) hwPick = '';
    var day = hwPick ? days.filter(function (d) { return d.date === hwPick; })[0] : days[0];
    var s = A.homework.stats(day.date);

    var html = '<div class="hw-day">' + hwDayHead(day, s,
      (hwPick ? '<span class="pill mid">往日</span>' : '<span class="pill mid">最新</span>'));
    html += hwBlocksHTML(day) ||
      '<p style="color:var(--ink3);font-size:14px;padding:6px 0 12px">这一天没有需要孩子做的任务。</p>';
    if (s.parentLeft) {
      html += '<p style="font-size:12.5px;color:var(--ink3);margin:6px 0 12px">' +
        '👨‍👩‍👧 还有 ' + s.parentLeft + ' 件要提醒爸爸妈妈的事（在家长中心看）</p>';
    }
    if (hwPick) {
      html += '<div class="row" style="justify-content:center;margin:4px 0 12px">' +
        '<button class="btn sm ghost" data-hw-today="1">回到今天</button></div>';
    }
    html += '</div>';
    box.innerHTML = html;

    if (hist) {
      var older = days.filter(function (d) { return d.date !== day.date; });
      hist.innerHTML = older.length
        ? '<div class="sec-head" style="margin:18px 0 8px"><h2>🗂 以前的作业</h2></div>' +
          older.map(function (d) {
            var ds = A.homework.stats(d.date);
            return '<div class="hw-hist-item" data-hw-date="' + d.date + '">' +
              '<span class="hw-hist-date">' + d.date.slice(5).replace('-', '/') + '</span>' +
              '<span class="hw-hist-sum">' + ds.total + ' 项 · 做完 ' + ds.done + ' 项' +
              (ds.left ? '（还有 ' + ds.left + ' 项）' : ' ✅') + '</span></div>';
          }).join('')
        : '';
    }
  }

  /* ======================================================================
     事件绑定
     ====================================================================== */
  document.addEventListener('click', function (e) {
    var t = e.target;

    /* 手动打勾：给没有接入 SDK 的内容（如可打印材料、线下活动）用 */
    var mk = t.closest('[data-mark]');
    if (mk) {
      var mid = mk.getAttribute('data-mark');
      var pp = prog(mid) || {};
      if (pp.status === 'done') {
        pp.status = 'doing'; pp.stars = 0;
        DB.profile.stars = Math.max(0, DB.profile.stars - A.STARS_PER_DONE);
        A.toast('已撤销完成标记');
      } else {
        pp.status = 'done'; pp.stars = A.STARS_PER_DONE;
        DB.profile.stars += A.STARS_PER_DONE;
        A.touchStreak(); A.celebrate();
        A.toast('太棒了！+' + A.STARS_PER_DONE + ' ⭐');
      }
      pp.lastAt = Date.now();
      DB.progress[mid] = pp;
      DB.save(); A.checkAchievements(); render();
      return;
    }

    /* 作业打勾 / 取消打勾 */
    var hw = t.closest('[data-hw]');
    if (hw) {
      var hp = hw.getAttribute('data-hw').split('|');
      var hrec = A.homework.toggle(hp[0], hp[1]);
      if (hrec) {
        var hs = A.homework.stats(hp[0]);
        if (hrec.doneAt && hs.total && hs.left === 0) { A.celebrate(); A.toast('今天的作业全做完啦 🎉'); }
        else A.toast(hrec.doneAt ? '完成一项 👍' : '已取消打勾');
      }
      render();
      return;
    }
    var hdate = t.closest('[data-hw-date]');
    if (hdate) {
      hwPick = hdate.getAttribute('data-hw-date');
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (t.closest('[data-hw-today]')) { hwPick = ''; render(); return; }

    /* 错题本操作 */
    var fx = t.closest('[data-fix]');
    if (fx) {
      A.mistakes.fix(fx.getAttribute('data-fix'));
      A.bumpMeta('fixedMistakes');
      if (A.mistakes.stats().pending === 0) A.bumpMeta('clearedOnce');
      A.checkAchievements();
      A.toast('这题搞定啦 👏');
      render();
      return;
    }
    var uf = t.closest('[data-unfix]');
    if (uf) { A.mistakes.unfix(uf.getAttribute('data-unfix')); render(); return; }

    var pk = t.closest('[data-peek]');
    if (pk) {
      var el = document.getElementById('ans-' + encodeURIComponent(pk.getAttribute('data-peek')));
      if (el) el.classList.toggle('hidden');
      return;
    }

    var go = t.closest('[data-go]');
    if (go) { var m = A.moduleById(go.getAttribute('data-go')); if (m) A.enterModule(m); return; }

    var dv = t.closest('[data-view]');
    if (dv) { state.view = dv.getAttribute('data-view'); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }

    var ds = t.closest('[data-sub]');
    if (ds) { state.subject = ds.getAttribute('data-sub'); renderCourses(); return; }

    var av = t.closest('[data-avatar]');
    if (av) { DB.profile.avatar = av.getAttribute('data-avatar'); DB.save(); render(); return; }

    var act = t.closest('[data-act]');
    if (act) {
      var a = act.getAttribute('data-act');
      if (a === 'help') helpSheet();
      return;
    }
    if (t.hasAttribute('data-close')) A.closeSheet();
  });

  ['home', 'courses', 'review', 'badges'].forEach(function (v) {
    ['nav-' + v, 'tab-' + v].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.addEventListener('click', function () {
        state.view = v; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
  });

  document.getElementById('search').addEventListener('input', function (e) {
    state.q = e.target.value.trim(); renderCourses();
  });
  document.getElementById('avatarBtn').addEventListener('click', function () {
    A.sheet('选择头像', '挑一个你喜欢的小动物吧',
      '<div id="avatarPick2" style="display:flex;gap:8px;flex-wrap:wrap">' +
      AVATARS.map(function (a) {
        return '<button class="btn sm' + (DB.profile.avatar === a ? ' primary' : '') + '" data-avatar="' + a +
          '" style="font-size:20px;padding:7px 12px">' + a + '</button>';
      }).join('') + '</div>');
  });
  document.getElementById('btnHelp').addEventListener('click', helpSheet);

  function helpSheet() {
    A.sheet('怎么用这个学习台', '三步就能开始',
      '<ol style="padding-left:20px;line-height:2;margin:0 0 14px">' +
      '<li><b>点卡片就能学</b>：首页或"全部课程"里点任意一张卡片，直接打开对应内容。</li>' +
      '<li><b>学完自动记星星</b>：内容学完会自动加 ⭐，答错的题会自己跑进"错题本"。</li>' +
      '<li><b>隔天看看错题本</b>：想明白了点一下"我想出来了"，那题就出本子了。</li>' +
      '</ol>' +
      '<div class="panel" style="background:var(--brand-xl);border-color:#e0ebfb;margin:0">' +
      '<h3 style="font-size:15.5px">👨‍👩‍👧 家长看这里</h3>' +
      '<p style="margin:6px 0 0;font-size:14px;color:var(--ink2)">' +
      '学习报告、内容管理、错题分析都在<b>家长中心</b>（页面最底部"家长入口"，需要家长密码）。' +
      '密码由家长第一次进入时自己设置。</p></div>');
  }

  /* 护眼休息提醒：连续使用达到设定时长后弹一次 20-20-20 提示 */
  var breakTimer = null, sessionStart = Date.now();
  function breakSheet() {
    A.sheet('休息一下眼睛吧 👀', '已经连续学习一段时间了',
      '<div style="text-align:center;padding:6px 0 2px">' +
      '<div style="font-size:56px">🌳</div>' +
      '<p style="font-size:16.5px;line-height:2;margin:10px 0 18px">' +
      '看看窗外 <b>20 秒</b> 远处的绿树，<br>再眨眨眼睛、伸个懒腰～</p>' +
      '<button class="btn primary" data-close>我休息好啦</button></div>');
  }
  function startBreakWatch() {
    clearInterval(breakTimer);
    sessionStart = Date.now();
    breakTimer = setInterval(function () {
      if (!DB.settings.breakOn) return;
      var every = (DB.settings.breakEvery || 20) * 60000;
      if (Date.now() - sessionStart >= every) { sessionStart = Date.now(); breakSheet(); }
    }, 30000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') sessionStart = Date.now();
    });
  }

  /* 接收 iframe 内模块的 postMessage 事件 */
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (d && d.__xyb) A.onModuleEvent({ id: d.id, event: d.event, data: d.data });
  });

  /* 返回本页时：结算上次学习时长 + 处理模块上报 */
  window.addEventListener('pageshow', function (ev) {
    if (ev.persisted) { A.bootCore(); render(); }
  });

  /* ======================================================================
     启动 + 多端同步
     ====================================================================== */
  function agoText(ts) {
    var d = Date.now() - ts;
    if (d < 0) return '刚刚';
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    return Math.floor(d / 86400000) + ' 天前';
  }

  /* 页脚那行小字：没开同步时整行不显示（默认就是这个状态，孩子看不到任何变化） */
  function paintSync() {
    var el = document.getElementById('syncState');
    if (!el) return;
    var S = window.XYBSync;
    if (!S) { el.classList.add('hide'); return; }
    var st = S.status();
    if (!st.enabled) { el.textContent = ''; el.classList.add('hide'); return; }

    var cls = 'sync-state', txt;
    if (st.lastError) { cls += ' bad'; txt = '⚠️ 同步失败'; }
    else if (st.busy) { cls += ' warn'; txt = '☁️ 正在同步…'; }
    else if (st.pending) { cls += ' warn'; txt = '☁️ ' + st.pending + ' 条待同步'; }
    else if (st.lastSyncAt) { cls += ' ok'; txt = '☁️ 已同步 · ' + agoText(st.lastSyncAt); }
    else { cls += ' warn'; txt = '☁️ 等待首次同步'; }
    el.className = cls;
    el.textContent = txt;
  }

  /* 只有家长端开过同步之后才真正启动；同步回来用权威数据重画一遍 */
  function startSync() {
    var S = window.XYBSync;
    if (!S) return;
    S.onChange(function (r) {
      paintSync();
      if (r && r.ok !== false) render();      /* flush 内部已 rebuild，这里只需重画 */
    });
    paintSync();
    var p = S.boot();
    if (p && p.then) p.then(function (r) {
      paintSync();
      if (r && !r.skipped) render();
    });
  }

  function boot() {
    A.bootCore();
    A.touchStreak();
    A.checkAchievements();
    DB.save();
    render();
    startSync();
    startBreakWatch();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* 调试用 */
  window.XYB_APP = { app: A, state: state, render: render };
})();
