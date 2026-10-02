/* ==========================================================================
   小悦饼学习工作台 · jsdom 真实 DOM 冒烟测试
   --------------------------------------------------------------------------
   背景（沿用本项目 2026-09-11 的教训）：顶层脚本里任何一个未捕获错误，
   都会让后续所有事件绑定静默失效 —— node --check 查语法是查不出这种问题的。
   所以工作台必须有真实 DOM 冒烟测试。

   本文件覆盖两块：
     A. 孩子端 index.html —— 渲染 / 筛选 / 打勾 / 时长结算 / SDK 上报 / 错题本
     B. 家长端 parent.html —— PIN 门禁 / 概览 / 错题面板 / 内容显隐 / 设置

   运行：
     set NODE_PATH=<jsdom 所在的 node_modules 目录>
     node _build/smoke_test.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else {
    fail++;
    failures.push(name + (extra ? '  \u2192 ' + extra : ''));
    console.log('  \u00d7 ' + name + (extra ? '  \u2192 ' + extra : ''));
  }
}
function eq(name, actual, expect) {
  ok(name, actual === expect, 'actual=' + JSON.stringify(actual) + ' expect=' + JSON.stringify(expect));
}
const section = (t) => console.log('\n' + t);

/* --------------------------------------------------------------------------
   启动一个页面实例（去掉 HTML 里的 script 标签，手动按顺序注入，便于抓错）
   -------------------------------------------------------------------------- */
function makeWindow(pageFile, scripts) {
  /* 把 HTML 里所有 <script>（外链和内联）都摘掉，稍后按顺序手动注入 ——
     否则模块页的内联脚本会在解析时就先跑，那时 SDK 还没加载，
     必然抛 "XYB is not defined"，事件绑定也会重复注册一次 */
  const html = read(pageFile).replace(/<script[\s\S]*?<\/script>/g, '');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    /* jsdom 未实现 scrollTo / matchMedia 等环境告警，不属于页面代码错误 */
    if (/Not implemented/.test(e.message || '')) return;
    errors.push('jsdomError: ' + e.message);
  });
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const dom = new JSDOM(html, {
    url: 'http://localhost/' + pageFile,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const w = dom.window;
  w.addEventListener('error', (e) => errors.push('window.error: ' + (e.message || e.error)));
  w.addEventListener('unhandledrejection', (e) => errors.push('unhandled: ' + e.reason));
  return { w, errors, scripts };
}

function runScripts(g, seed) {
  const w = g.w;
  if (seed) Object.keys(seed).forEach((k) => w.localStorage.setItem(k, seed[k]));
  ['assets/catalog.js'].concat(g.scripts).forEach((f) => {
    try { w.eval(read(f)); }
    catch (e) { g.errors.push(f + ': ' + e.message); }
  });
  return g;
}

const $ = (w, sel) => w.document.querySelector(sel);
const $$ = (w, sel) => Array.from(w.document.querySelectorAll(sel));
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
const fire = (w, el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
const ls = (w, k) => { const v = w.localStorage.getItem('xyb.v1.' + k); return v ? JSON.parse(v) : null; };
const visible = (w, id) => !$(w, '#' + id).classList.contains('hide');
const hasClass = (w, sel, c) => !!$(w, sel) && $(w, sel).classList.contains(c);

/* 把 localStorage 里 xyb.v1.* 全量取出来，用于"孩子端 → 家长端"的数据接力 */
function dumpLS(w) {
  const out = {};
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = w.localStorage.key(i);
    if (k.indexOf('xyb.v1.') === 0) out[k] = w.localStorage.getItem(k);
  }
  return out;
}

function clickChip(w, name) {
  const c = $$(w, '#chips .chip').find((x) => x.getAttribute('data-sub') === name);
  if (c) click(w, c);
  return !!c;
}
function clearSearch(w) {
  const s = $(w, '#search');
  s.value = '';
  fire(w, s, 'input');
}
function firePageShow(w) {
  const ev = w.document.createEvent('Event');
  ev.initEvent('pageshow', false, false);
  Object.defineProperty(ev, 'persisted', { value: true });
  w.dispatchEvent(ev);
}
/* 走一遍门禁表单 */
function enterGate(w, pin, pin2) {
  $(w, '#gatePin').value = pin;
  const el2 = $(w, '#gatePin2');
  if (pin2 != null && !el2.classList.contains('hide')) el2.value = pin2;
  $(w, '#gateForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}

/* ==========================================================================
   A. 孩子端
   ========================================================================== */
async function testStudent() {
  console.log('\n' + '#'.repeat(52));
  console.log('# A. 孩子端 index.html');
  console.log('#'.repeat(52));

  const G = runScripts(makeWindow('index.html', ['assets/core.js', 'assets/student.js']));
  await new Promise((r) => setTimeout(r, 80));
  const w = G.w;

  section('[A1] 加载与页面隔离');
  ok('页面加载零 JS 错误', G.errors.length === 0, G.errors.join(' | '));
  ok('XYBApp 核心层已挂载', !!(w.XYBApp && w.XYBApp.DB));
  ok('XYB_APP 孩子端已挂载', !!w.XYB_APP);
  ok('catalog 已加载', !!(w.XYB_CATALOG && w.XYB_CATALOG.modules.length));
  eq('孩子端不存在家长视图节点', $(w, '#view-parent'), null);
  eq('孩子端不存在家长导航按钮', $(w, '#nav-parent'), null);
  eq('孩子端不存在"家长中心"Tab', $(w, '#tab-parent'), null);
  ok('孩子端存在家长入口链接', !!$(w, '#parentEntry'));
  eq('孩子端入口指向 parent.html', $(w, '#parentEntry').getAttribute('href'), './parent.html');
  eq('孩子端没有家长明细表', $(w, '#pTable'), null);
  eq('孩子端没有家长设置项', $(w, '#setName'), null);
  eq('孩子端没有导出按钮', $(w, '[data-act="export"]'), null);
  ok('孩子端页面源码不含 parent.js', read('index.html').indexOf('parent.js') < 0);

  section('[A2] 首页渲染');
  eq('首页推荐卡片数 = featured 已上线内容', $$(w, '#homeGrid .mcard').length, 3);
  eq('学习路径分组数', $$(w, '#pathBox .path').length, 4);
  eq('路径节点数', $$(w, '#pathBox .step').length, 5);
  eq('徽章预览数', $$(w, '#homeBadges .badge-card').length, 6);
  ok('今日目标环已渲染 SVG', !!$(w, '#todayRing svg'));
  ok('今日进度显示 0/3', $(w, '#todayRing .ring-txt').textContent.indexOf('0/3') === 0);

  section('[A3] 视图切换');
  ok('默认显示首页', visible(w, 'view-home'));
  click(w, $(w, '#nav-courses'));
  ok('切到全部课程', visible(w, 'view-courses') && !visible(w, 'view-home'));
  eq('学科筛选条数量 = 全部 + 7 学科', $$(w, '#chips .chip').length, 8);
  eq('全部课程卡片数（5 上线 + 5 规划）', $$(w, '#allGrid .mcard').length, 10);
  eq('规划中占位卡数', $$(w, '#allGrid .mcard.planned').length, 5);
  eq('手动打勾按钮数 = 1（只有数独）', $$(w, '#allGrid [data-mark]').length, 1);
  ok('今日任务条在非首页隐藏', !visible(w, 'todayBox'));

  click(w, $(w, '#nav-review'));
  ok('切到错题本', visible(w, 'view-review'));
  ok('错题本为空时给空状态', !!$(w, '#reviewBox .empty'));
  eq('错题本指标卡数量', $$(w, '#reviewKpi .kpi').length, 3);

  click(w, $(w, '#nav-badges'));
  ok('切到成就页', visible(w, 'view-badges'));
  eq('徽章总数', $$(w, '#badgeGrid .badge-card').length, 12);
  eq('未获得徽章全部上锁', $$(w, '#badgeGrid .badge-card.locked').length, 12);

  section('[A4] 筛选与搜索');
  click(w, $(w, '#nav-courses'));
  clickChip(w, '语文');
  eq('筛选「语文」= 拼音(上线) + 识字/古诗(规划)', $$(w, '#allGrid .mcard').length, 3);
  clickChip(w, '全部');
  eq('重置为全部', $$(w, '#allGrid .mcard').length, 10);

  const search = $(w, '#search');
  search.value = '数独';
  fire(w, search, 'input');
  eq('搜索「数独」命中', $$(w, '#allGrid .mcard').length, 1);
  search.value = '拼音';
  fire(w, search, 'input');
  eq('搜索「拼音」命中', $$(w, '#allGrid .mcard').length, 1);
  search.value = 'zzzzz';
  fire(w, search, 'input');
  ok('无结果时显示空状态', !!$(w, '#allGrid .empty'));
  clearSearch(w);
  eq('清空搜索后恢复', $$(w, '#allGrid .mcard').length, 10);

  section('[A5] 手动打勾 → 星星 → 徽章');
  const markBtn = $(w, '#allGrid [data-mark]');
  eq('打勾按钮指向数独', markBtn.getAttribute('data-mark'), 'sudoku-1');
  click(w, markBtn);
  let prog = ls(w, 'progress');
  eq('状态置为 done', prog['sudoku-1'].status, 'done');
  eq('获得 3 颗星', prog['sudoku-1'].stars, 3);
  eq('总星星数 +3', ls(w, 'profile').stars, 3);
  ok('点亮「启蒙之星」徽章', !!ls(w, 'achievements')['first']);
  click(w, $(w, '#allGrid [data-mark]'));
  eq('撤销后星星扣回', ls(w, 'profile').stars, 0);
  click(w, $(w, '#allGrid [data-mark]'));
  eq('重新打勾后星星为 3', ls(w, 'profile').stars, 3);

  section('[A6] 学习时长结算（从模块返回）');
  w.localStorage.setItem('xyb.v1.session', JSON.stringify({ mid: 'sudoku-1', at: Date.now() - 3 * 60000 }));
  firePageShow(w);
  const timeMs = ls(w, 'progress')['sudoku-1'].timeMs || 0;
  ok('3 分钟停留被结算进时长', timeMs >= 170000, 'timeMs=' + timeMs);
  eq('session 已被清掉', w.localStorage.getItem('xyb.v1.session'), null);
  click(w, $(w, '#nav-home'));
  ok('今日目标环更新为 1/3', $(w, '#todayRing .ring-txt').textContent.indexOf('1/3') === 0);

  section('[A7] 模块 SDK 上报 + 错题入库');
  w.localStorage.setItem('xyb.v1.inbox', JSON.stringify([
    { id: 'math-calc', event: 'ready', data: {} },
    { id: 'math-calc', event: 'answer', data: { correct: true } },
    { id: 'math-calc', event: 'answer', data: { correct: false, tag: '20以内加法', q: '7 + 8 = ?', answer: 15, my: 16 } },
    { id: 'math-calc', event: 'progress', data: { done: 7, total: 10 } },
    { id: 'math-calc', event: 'finish', data: { stars: 3, score: 7 } },
    { id: 'pinyin-1', event: 'answer', data: { correct: false, tag: '声母听辨', q: '「爸爸」的声母是？', answer: 'b', my: 'p' } },
    /* 老模块不带题干：不应误入错题本 */
    { id: 'math-calc', event: 'answer', data: { correct: false } }
  ]));
  firePageShow(w);
  eq('inbox 已清空', w.localStorage.getItem('xyb.v1.inbox'), null);
  const mp = ls(w, 'progress')['math-calc'];
  eq('math-calc 状态 = done', mp.status, 'done');
  eq('答题数累计 = 3', mp.asked, 3);
  eq('答对数累计 = 1', mp.right, 1);
  eq('进度记录 done/total', mp.done + '/' + mp.total, '7/10');
  eq('星星累计 = 6', ls(w, 'profile').stars, 6);

  const mis = ls(w, 'mistakes');
  eq('错题本收录 2 道（无题干的没进）', mis.length, 2);
  eq('错题带模块来源', mis.map((m) => m.mid).sort().join(','), 'math-calc,pinyin-1');
  ok('错题记录了孩子的答案', mis.some((m) => m.my === '16'));
  ok('错题记录了正确答案', mis.some((m) => m.answer === '15'));

  /* 同一题再错一次 → 次数累加不重复入库 */
  w.localStorage.setItem('xyb.v1.inbox', JSON.stringify([
    { id: 'math-calc', event: 'answer', data: { correct: false, tag: '20以内加法', q: '7 + 8 = ?', answer: 15, my: 14 } }
  ]));
  firePageShow(w);
  const mis2 = ls(w, 'mistakes');
  eq('重复错题不新增条目', mis2.length, 2);
  eq('错误次数累加为 2', mis2.filter((m) => m.mid === 'math-calc')[0].times, 2);

  section('[A8] 错题本视图与订正');
  click(w, $(w, '#nav-review'));
  eq('错题卡片数', $$(w, '#reviewBox .mfcard').length, 2);
  eq('两题都是待订正', $$(w, '#reviewBox .pill.mid').length, 2);
  ok('顶栏错题角标显示 2', $(w, '#reviewDot').textContent === '2');
  ok('底部 Tab 角标同步', $(w, '#reviewDot2').textContent === '2');

  click(w, $(w, '#reviewBox [data-peek]'));
  ok('点"看看答案"展开答案区', !hasClass(w, '#reviewBox .mf-ans', 'hidden'));

  click(w, $(w, '#reviewBox [data-fix]'));
  eq('订正后剩 1 道待订正', ls(w, 'mistakes').filter((m) => !m.fixed).length, 1);
  eq('订正记录写进 meta', ls(w, 'meta').fixedMistakes, 1);
  ok('角标跟着减少', $(w, '#reviewDot').textContent === '1');
  ok('已订正的卡片换成"重新练"按钮', !!$(w, '#reviewBox [data-unfix]'));

  click(w, $(w, '#reviewBox [data-unfix]'));
  eq('退回后又是 2 道待订正', ls(w, 'mistakes').filter((m) => !m.fixed).length, 2);

  click(w, $(w, '#nav-home'));
  ok('首页出现错题提醒按钮', !!$(w, '#continueBox [data-view="review"]'));

  section('[A9] 弹层与全流程错误检查');
  click(w, $(w, '#avatarBtn'));
  ok('点头像弹出选择层', !!$(w, '.sheet-mask'));
  click(w, $(w, '.sheet-mask [data-close]'));
  ok('弹层可关闭', !$(w, '.sheet-mask'));
  click(w, $(w, '#btnHelp'));
  ok('使用说明可打开', !!$(w, '.sheet-mask'));
  click(w, $(w, '.sheet-mask [data-close]'));
  ok('全部交互后仍零 JS 错误', G.errors.length === 0, G.errors.slice(0, 3).join(' | '));

  const seed = dumpLS(w);
  w.close();
  return seed;
}

/* ==========================================================================
   B. 家长端
   ========================================================================== */
async function testParent(seed) {
  console.log('\n' + '#'.repeat(52));
  console.log('# B. 家长端 parent.html');
  console.log('#'.repeat(52));

  /* B1：没有数据、也没设过密码 —— 首次进入应该先让家长设密码 */
  const G0 = runScripts(makeWindow('parent.html', ['assets/core.js', 'assets/parent.js']));
  await new Promise((r) => setTimeout(r, 80));
  const w0 = G0.w;

  section('[B1] 首次进入：先设密码，且看不到任何数据');
  ok('页面加载零 JS 错误', G0.errors.length === 0, G0.errors.join(' | '));
  ok('门禁默认可见', !hasClass(w0, '#gate', 'hide'));
  ok('家长主体默认隐藏', hasClass(w0, '#app', 'hide'));
  eq('门禁提示为"设置密码"', $(w0, '#gateSubmit').textContent, '设置并进入');
  ok('确认密码框可见', !hasClass(w0, '#gatePin2', 'hide'));
  eq('未解锁时概览区是空的', $(w0, '#pKpi').innerHTML, '');
  eq('未解锁时明细表是空的', $(w0, '#pTable').innerHTML, '');

  enterGate(w0, '1234', '9999');
  ok('两次输入不一致会报错', $(w0, '#gateErr').textContent.indexOf('不一致') > -1);
  ok('不一致时仍不放行', hasClass(w0, '#app', 'hide'));

  enterGate(w0, '123', '123');
  ok('密码位数不足会报错', $(w0, '#gateErr').textContent.indexOf('4~6') > -1);

  enterGate(w0, '1234', '1234');
  ok('设置成功后进入家长中心', !hasClass(w0, '#app', 'hide') && hasClass(w0, '#gate', 'hide'));
  ok('密码已写入本地', !!ls(w0, 'guard') && !!ls(w0, 'guard').pin);
  ok('密码不是明文存储', ls(w0, 'guard').pin !== '1234');
  w0.close();

  /* B2：带着孩子端的数据、且已设密码 —— 正常解锁 */
  const seedWithGuard = Object.assign({}, seed, {
    'xyb.v1.guard': JSON.stringify({ pin: quickHash('1234'), setAt: Date.now(), fails: 0, lockUntil: 0 })
  });
  const G = runScripts(makeWindow('parent.html', ['assets/core.js', 'assets/parent.js']), seedWithGuard);
  await new Promise((r) => setTimeout(r, 80));
  const w = G.w;

  section('[B2] 已有密码：输错拦、输对进');
  ok('页面加载零 JS 错误', G.errors.length === 0, G.errors.join(' | '));
  ok('仍然锁着', hasClass(w, '#app', 'hide'));
  eq('门禁提示为"输入密码"', $(w, '#gateSubmit').textContent, '进入家长中心');

  enterGate(w, '0000');
  ok('输错给出提示', $(w, '#gateErr').textContent.indexOf('密码不对') > -1);
  ok('输错不放行', hasClass(w, '#app', 'hide'));
  eq('错误次数已记录', ls(w, 'guard').fails, 1);
  eq('输错后输入框被清空', $(w, '#gatePin').value, '');

  enterGate(w, '1234');
  ok('输对后进入家长中心', !hasClass(w, '#app', 'hide'));
  eq('失败计数被重置', ls(w, 'guard').fails, 0);

  section('[B3] 家长端渲染');
  eq('概览指标卡数量', $$(w, '#pKpi .kpi').length, 6);
  eq('学习明细行数 = 已上线内容数', $$(w, '#pTable tbody tr').length, 5);
  ok('明细表出现错题数列', $(w, '#pTable thead').textContent.indexOf('错题') > -1);
  ok('明细表出现正确率', $(w, '#pTable').textContent.indexOf('25%') > -1);
  ok('明细表出现时长', $(w, '#pTable').textContent.indexOf('3 分') > -1);
  eq('内容管理开关数 = 全部条目', $$(w, '#pModules .switch').length, 10);
  eq('头像可选数量', $$(w, '#avatarPick [data-avatar]').length, 12);
  ok('昵称回填正确', $(w, '#setName').value === '小悦饼');
  ok('密码状态显示已开启', $(w, '#guardState').textContent.indexOf('已开启') > -1);

  section('[B4] 错题本面板');
  eq('筛选条数量', $$(w, '#mstChips .chip').length, 3);
  eq('错题表行数', $$(w, '#mstBox tbody tr').length, 2);
  ok('表格里有题干', $(w, '#mstBox').textContent.indexOf('7 + 8 = ?') > -1);
  ok('表格里标出了错过几次', $(w, '#mstBox').textContent.indexOf('2 次') > -1);

  const pendingChip = $$(w, '#mstChips .chip').find((c) => c.getAttribute('data-mfilter') === 'pending');
  click(w, pendingChip);
  eq('按"待订正"筛选后仍 2 行', $$(w, '#mstBox tbody tr').length, 2);
  click(w, $$(w, '#mstChips .chip')[0]);

  click(w, $(w, '#mstBox [data-mfix]'));
  eq('家长标记订正后剩 1 道待订正', ls(w, 'mistakes').filter((m) => !m.fixed).length, 1);
  click(w, $(w, '#mstBox [data-mfix]'));
  eq('再点一次退回待订正', ls(w, 'mistakes').filter((m) => !m.fixed).length, 2);

  section('[B5] 内容显隐与设置');
  click(w, $$(w, '#pModules .sw')[1]);
  eq('hidden 列表长度', (ls(w, 'hidden') || []).length, 1);
  click(w, $$(w, '#pModules .sw')[1]);
  eq('再点一次恢复', (ls(w, 'hidden') || []).length, 0);

  const nameInput = $(w, '#setName');
  nameInput.value = '小豆丁';
  fire(w, nameInput, 'change');
  eq('昵称已保存（与孩子端共享同一份数据）', ls(w, 'profile').name, '小豆丁');

  const goalInput = $(w, '#setGoal');
  goalInput.value = '5';
  fire(w, goalInput, 'change');
  eq('每日目标已保存', ls(w, 'settings').dailyGoal, 5);

  click(w, $(w, '#swBreak'));
  eq('护眼提醒开关可关闭', ls(w, 'settings').breakOn, false);
  click(w, $(w, '#avatarPick [data-avatar]'));
  ok('头像可切换', ls(w, 'profile').avatar === $(w, '#avatarPick [data-avatar]').getAttribute('data-avatar'));

  section('[B6] 锁定与改密码');
  click(w, $(w, '[data-act="lock"]'));
  ok('点锁定后回到门禁', hasClass(w, '#app', 'hide') && !hasClass(w, '#gate', 'hide'));

  enterGate(w, '1234');
  click(w, $(w, '[data-act="changePin"]'));
  ok('改密码弹层已打开', !!$(w, '#pinSave'));
  $(w, '#pinNew').value = '5678';
  $(w, '#pinNew2').value = '5678';
  click(w, $(w, '#pinSave'));
  eq('新密码已生效', ls(w, 'guard').pin, quickHash('5678'));
  eq('弹层已关闭', $(w, '.sheet-mask'), null);

  click(w, $(w, '[data-act="lock"]'));
  enterGate(w, '5678');
  ok('用新密码可以进入', !hasClass(w, '#app', 'hide'));

  section('[B7] 门禁输入健壮性（全角数字/空格不能静默失效）');
  /* 背景：输入框上带 pattern="[0-9]*" 时，中文输入法打出的全角数字会被浏览器原生校验
     拦下提交事件，页面既不报错也不放行 —— 表现成"点了没反应"。这两条用例把它钉死。 */
  ok('密码框没有 pattern 属性（防原生校验静默拦截）',
    !$(w, '#gatePin').hasAttribute('pattern') && !$(w, '#gatePin2').hasAttribute('pattern'));

  click(w, $(w, '[data-act="lock"]'));
  const elFull = $(w, '#gatePin');
  elFull.value = '５６７８';            /* 全角数字 */
  fire(w, elFull, 'input');
  eq('全角数字被自动转成半角', elFull.value, '5678');
  $(w, '#gateForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  ok('净化后的密码能正常进入家长中心', !hasClass(w, '#app', 'hide'));

  click(w, $(w, '[data-act="lock"]'));
  const elSpace = $(w, '#gatePin');
  elSpace.value = '5 6 7 8';
  fire(w, elSpace, 'input');
  eq('中间的空格被去掉', elSpace.value, '5678');

  enterGate(w, '12ab');
  ok('非法输入给出可见错误提示（不是静默无反应）', hasClass(w, '#gateErr', 'on'));
  eq('非法输入不放行', hasClass(w, '#app', 'hide'), true);

  ok('全流程零 JS 错误', G.errors.length === 0, G.errors.slice(0, 3).join(' | '));

  w.close();
}

/* 复刻 parent.js 里的口令哈希，用于构造/断言 guard */
function quickHash(p) {
  var s = 'xyb::' + p + '::小悦饼', h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/* ==========================================================================
   C. 各个学习模块页（它们也是独立页面，同样要防"事件绑定静默失效"）
   ========================================================================== */
function catalogEntries() {
  const cat = read('assets/catalog.js');
  const out = [];
  const re = /^ {4}\{\r?\n([\s\S]*?)\r?\n {4}\}(?:,)?\r?\n/gm;
  let m;
  while ((m = re.exec(cat))) {
    const b = m[1];
    const id = (b.match(/id:\s*'([^']+)'/) || [])[1];
    const url = (b.match(/url:\s*'([^']+)'/) || [])[1];
    const st = (b.match(/status:\s*'([^']+)'/) || [])[1];
    if (id && url) out.push({ id, url, status: st || 'ready' });
  }
  return out;
}
function extractInline(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out.join('\n;\n');
}
/* 给模块页装一个"假语音合成"，用来在 jsdom 里复现 iOS 上几种**静默失败**：
   mode='ok'     正常出声（onstart 会触发）
   mode='silent' 什么都不触发 —— 就像设备没中文语音 / 静音开关拨着 / 没有用户手势
   mode='error'  直接报错 */
function installFakeSpeech(w, cfg) {
  cfg = cfg || {};
  const voices = cfg.voices || [{ name: 'Tingting', lang: 'zh-CN', localService: true }];
  const spoke = [];
  function Utt(text) { this.text = text; this.lang = ''; this.rate = 1; this.pitch = 1; this.voice = null; }
  w.SpeechSynthesisUtterance = Utt;
  w.speechSynthesis = {
    speaking: false, pending: false,
    getVoices: function () { return voices; },
    cancel: function () { this.speaking = false; },
    resume: function () {},
    addEventListener: function () {},
    speak: function (u) {
      spoke.push(u);
      this.speaking = true;
      const self = this;
      if (cfg.mode === 'silent') return;
      if (cfg.mode === 'error') { self.speaking = false; if (u.onerror) u.onerror({ error: 'fake' }); return; }
      setTimeout(function () { self.speaking = false; if (u.onstart) u.onstart(); }, 5);
    }
  };
  w.__spoke = spoke;
  return spoke;
}
/* 假的 Audio：用来验证"真音频优先"这条路径（不依赖系统语音）。
   play() 默认 resolve（= 正常播放），cfg.reject=true 时 reject（= 被自动播放策略拦下） */
function installFakeAudio(w, cfg) {
  cfg = cfg || {};
  const played = [];
  function FakeAudio(src) { this.src = src; }
  FakeAudio.prototype.play = function () {
    played.push(this.src);
    return cfg.reject ? Promise.reject(new Error('blocked')) : Promise.resolve();
  };
  FakeAudio.prototype.pause = function () {};
  w.Audio = FakeAudio;
  w.__audio = played;
  return played;
}
function bootModule(file, opt) {
  /* 先加载 SDK（等价于页面里的 <script src="../../assets/xyb-sdk.js">），
     再执行模块自己的内联脚本。opt.scripts 可以补模块页自带的额外脚本
     （比如拼音页的发音音频包 audio.js）。 */
  opt = opt || {};
  const g = makeWindow(file, ['assets/xyb-sdk.js'].concat(opt.scripts || []));
  if (opt.speech) installFakeSpeech(g.w, opt.speech);
  if (opt.audio) installFakeAudio(g.w, opt.audio);
  /* opt.globals：往 window 上直接塞数据（例如视频清单 XYB_VIDEOS）。
     有些模块的数据来自页面里另一个 <script src>，测试里不方便加载真实文件，
     就直接注入。必须放在 runScripts 之前 —— 模块内联脚本一执行就会读它。 */
  if (opt.globals) Object.assign(g.w, opt.globals);
  runScripts(g, opt.seed);
  try { g.w.eval(extractInline(read(file))); }
  catch (e) { g.errors.push('inline: ' + e.message); }
  return g;
}

/* 有些模块的数据不在页面里，而在另一个 <script src> 里（例如视频清单 videos.js）。
   测试里不加载真实文件，直接注入假数据 —— 这样测试结果不会被
   "你实际放了几个视频、叫什么名字"影响。 */
function fakeVideoList() {
  return {
    generatedAt: '2026-09-23 00:00:00',
    total: 4,
    totalSeconds: 1800,
    subjects: [
      { name: '语文', emoji: '📖', color: '#3b82f6', count: 2, seconds: 700, series: [
        { name: '拼音儿歌', count: 1, seconds: 300, items: [
          { id: '语文/拼音儿歌/01-a.mp4', title: '拼音儿歌', file: '../../videos/语文/拼音儿歌/01-a.mp4',
            sec: 300, size: 1048576, ok: true, vcodec: 'avc1', acodec: 'mp4a' }
        ] },
        { name: '汉字的故事', count: 1, seconds: 400, items: [
          { id: '语文/汉字的故事/01-b.mp4', title: '汉字的故事', file: '../../videos/语文/汉字的故事/01-b.mp4',
            sec: 400, size: 2097152, ok: true, vcodec: 'avc1', acodec: 'mp4a' }
        ] }
      ] },
      { name: '数学', emoji: '➗', color: '#f59e0b', count: 2, seconds: 1100, series: [
        { name: '认识图形', count: 2, seconds: 1100, items: [
          { id: '数学/认识图形/01-图形.mp4', title: '认识图形', file: '../../videos/数学/认识图形/01-图形.mp4',
            sec: 500, size: 3145728, ok: true, vcodec: 'avc1', acodec: 'mp4a' },
          { id: '数学/认识图形/02-编码不对.mp4', title: '编码不对的视频', file: '../../videos/数学/认识图形/02-编码不对.mp4',
            sec: 600, size: 4194304, ok: false, vcodec: 'hvc1', acodec: 'mp4a' }
        ] }
      ] }
    ]
  };
}

const MODULE_GLOBALS = {
  'video-1': { XYB_VIDEOS: fakeVideoList() },
};

async function testModules() {
  console.log('\n' + '#'.repeat(52));
  console.log('# C. 学习模块页');
  console.log('#'.repeat(52));

  const entries = catalogEntries().filter((e) => e.status === 'ready');
  ok('注册表里已上线内容 ≥ 3 个', entries.length >= 3, 'count=' + entries.length);

  for (const e of entries) {
    const file = e.url.replace(/^\.\//, '');
    const raw = read(file);
    console.log('\n[C] ' + e.id + '  ' + file);
    if (raw.indexOf('xyb-sdk.js') < 0) {
      console.log('  · 未接入 SDK（手动打勾模式），跳过自动化检查');
      ok(e.id + '：未接入 SDK 的模块文件存在', true);
      continue;
    }
    /* 有些模块的数据在另一个 <script src> 里（如视频清单），给它喂一份假的 */
    const G = bootModule(file, { globals: MODULE_GLOBALS[e.id] });
    await new Promise((r) => setTimeout(r, 40));
    const w = G.w;
    ok(e.id + '：页面启动零 JS 错误', G.errors.length === 0, G.errors.join(' | '));
    ok(e.id + '：SDK 已挂载且 id 一致', !!(w.XYB && w.XYB.id === e.id),
      'XYB.id=' + (w.XYB && w.XYB.id));
    ok(e.id + '：渲染出可交互按钮', w.document.querySelectorAll('button').length >= 5,
      'buttons=' + w.document.querySelectorAll('button').length);
    ok(e.id + '：有返回学习台的能力',
      raw.indexOf('data-back') > -1 || raw.indexOf('XYB.exit') > -1);
    if (raw.indexOf('XYB.answer') > -1) {
      ok(e.id + '：答错时上报了题干（错题本依赖它）', raw.indexOf('q:') > -1);
    } else {
      console.log('  · 该模块不涉及答题，跳过错题本检查');
    }
    w.close();
  }

  /* 拼音王国：走一遍"认字母 → 闯关答题 → 上报"的真实路径 */
  section('[C2] 拼音王国交互链路');
  const GP = bootModule('modules/pinyin-1/index.html');
  await new Promise((r) => setTimeout(r, 40));
  const p = GP.w;
  eq('23 个声母卡片', $$(p, '#letters .lt').length, 23);
  ok('读音不可用时给出提示而不是报错', GP.errors.length === 0, GP.errors.join(' | '));

  click(p, $(p, '#letters .lt'));
  ok('点字母弹出详情层', !!$(p, '.sheet-mask'));
  ok('详情层里有听读音按钮', !!$(p, '.sheet-mask [data-say]'));
  click(p, $(p, '.sheet-mask [data-close]'));
  ok('详情层可关闭', !$(p, '.sheet-mask'));
  const pInbox = ls(p, 'inbox') || [];
  ok('认字母写入了上报队列（完成度 1/23）',
    pInbox.some((x) => x.event === 'progress' && x.data.done === 1 && x.data.total === 23),
    JSON.stringify(pInbox));

  click(p, $(p, '#tab-play'));
  ok('切到闯关后出现题目', $(p, '#qBig').textContent.length > 0);
  eq('每题 3 个选项', $$(p, '#opts .opt').length, 3);

  click(p, $(p, '#opts .opt'));
  const inbox = ls(p, 'inbox') || [];
  const ansEvents = inbox.filter((x) => x.event === 'answer');
  eq('答题已写入上报队列', ansEvents.length, 1);
  ok('上报带上了题干', !!ansEvents[0].data.q);
  ok('上报带上了正确答案', ansEvents[0].data.answer !== '');
  ok('上报带上了孩子的答案', ansEvents[0].data.my !== '');
  ok('上报带上了知识点标签', !!ansEvents[0].data.tag);
  ok('交互后仍零 JS 错误', GP.errors.length === 0, GP.errors.slice(0, 2).join(' | '));
  p.close();

  /* 口算闪电侠：确认改造后仍然能跑，且上报带题干 */
  section('[C3] 口算闪电侠交互链路');
  const GM = bootModule('modules/math-calc/index.html');
  await new Promise((r) => setTimeout(r, 40));
  const m = GM.w;
  eq('数字键盘 12 个键', $$(m, '#pad .key').length, 12);
  ok('页面启动零 JS 错误', GM.errors.length === 0, GM.errors.join(' | '));
  click(m, $$(m, '#pad .key')[0]);
  ok('按键后答案框显示按下的数字',
    $(m, '#ansBox').textContent === $$(m, '#pad .key')[0].getAttribute('data-k'),
    'ansBox=' + JSON.stringify($(m, '#ansBox').textContent) +
    ' key=' + JSON.stringify($$(m, '#pad .key')[0].getAttribute('data-k')));
  click(m, $$(m, '#pad .key').find((k) => k.getAttribute('data-k') === 'ok'));
  const mInbox = ls(m, 'inbox') || [];
  const mAns = mInbox.filter((x) => x.event === 'answer');
  eq('口算答题已上报', mAns.length, 1);
  ok('口算上报也带了题干', !!mAns[0].data.q, JSON.stringify(mAns[0].data));
  m.close();
}

/* --------------------------------------------------------------------------
   C4. 拼音王国"没声音"的链路
   背景：iOS 上语音合成会因为 ①设备没中文语音 ②侧边静音开关 ③定时器里的朗读
   不算用户手势 ④家长关了开关 —— 而**全都不报错**，家长只能干瞪眼。
   这里用假语音合成把这几种情况都复现一遍，确保每一种都能变成"看得见的一句话"。
   -------------------------------------------------------------------------- */
async function testPinyinSound() {
  console.log('\n[C4] 拼音王国 · 声音链路（静默失败必须可见）');
  const FILE = 'modules/pinyin-1/index.html';
  const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));

  /* (1) 正常出声 */
  let g = bootModule(FILE, { speech: { mode: 'ok' } });
  await waitMs(40);
  let w = g.w;
  ok('C4.1 有中文语音时能挑到它', !!w.XYB.pickVoice('zh-CN'),
    JSON.stringify(w.XYB.voiceInfo()));
  ok('C4.2 页面有「声音自检」入口', !!$(w, '#soundCheckBtn'));
  click(w, $(w, '.lt[data-i="0"]'));
  await waitMs(1400);
  ok('C4.3 点字母会朗读示例词', w.__spoke.some((u) => u.text === '爸爸'),
    w.__spoke.map((u) => JSON.stringify(u.text)).join(','));
  ok('C4.4 首次手势顺带做一次静音预热（iOS 解锁语音引擎）',
    w.__spoke.some((u) => u.text === ' '), w.__spoke.map((u) => JSON.stringify(u.text)).join(','));
  ok('C4.5 读得出来时不给"没声音"提示', !hasClass(w, '#sayTip', 'on'),
    $(w, '#sayTip') && $(w, '#sayTip').textContent);
  const d0 = w.XYB.diagnostics();
  ok('C4.6 诊断接口给出的是原始事实（不做结论）',
    typeof d0.hasSynth === 'boolean' && typeof d0.voices === 'number' && !!d0.synthType,
    JSON.stringify(d0));
  w.close();

  /* (2) 完全静默：设备没中文语音 / 静音开关拨着 / 自动播放被拦 */
  g = bootModule(FILE, { speech: { mode: 'silent' } });
  await waitMs(40);
  w = g.w;
  click(w, $(w, '.lt[data-i="0"]'));
  await waitMs(2300);      /* saySound 现在试两次：0.9s + 1.1s */
  ok('C4.7 静默失败时弹层里出现排查建议', hasClass(w, '#sayTip', 'on'),
    $(w, '#sayTip') && $(w, '#sayTip').textContent);
  ok('C4.8 建议里点出了辅助功能/静音开关这类真原因',
    /辅助功能|静音开关/.test($(w, '#sayTip').textContent),
    $(w, '#sayTip').textContent);
  click(w, $(w, '#soundCheckBtn'));
  await waitMs(2900);      /* 现在会自动试两次：1.1s + 1.3s */
  ok('C4.9 自检给出"没出声"的结论', /没出声/.test($(w, '#chkResult').textContent),
    $(w, '#chkResult') && $(w, '#chkResult').textContent);
  eq('C4.10 并回传原始返回码（便于定位，而不是猜）', $(w, '#chkWhy').textContent, 'silent');
  ok('C4.11 自检里有"再试一次"按钮', !!$(w, '#chkRetry'));
  w.close();

  /* (3) 只有英文语音的设备（iOS 上很常见） */
  g = bootModule(FILE, {
    speech: { mode: 'silent', voices: [{ name: 'Samantha', lang: 'en-US' }] }
  });
  await waitMs(40);
  w = g.w;
  eq('C4.12 只有英文语音时挑不到中文语音', w.XYB.pickVoice('zh-CN'), null);
  ok('C4.13 页面顶部提前说清"没装中文语音"', /中文语音/.test($(w, '.hint').innerHTML),
    $(w, '.hint').textContent.slice(0, 30));
  click(w, $(w, '#soundCheckBtn'));
  await waitMs(2900);
  ok('C4.14 自检里如实说明"系统没报告语音"（不武断下结论）',
    /没报告|没有中文/.test(w.document.body.innerHTML));
  ok('C4.15 这条也会回传返回码', /novoice/.test($(w, '#chkWhy').textContent),
    $(w, '#chkWhy') && $(w, '#chkWhy').textContent);
  w.close();

  /* (4) 家长把"音效与语音"关了 */
  g = bootModule(FILE, {
    speech: { mode: 'ok' },
    seed: { 'xyb.v1.settings': JSON.stringify({ soundOn: false }) }
  });
  await waitMs(40);
  w = g.w;
  click(w, $(w, '.lt[data-i="0"]'));
  await waitMs(1400);
  eq('C4.16 开关关掉时一次都不发声（连预热也不做）', w.__spoke.length, 0);
  ok('C4.17 并说明是家长端那个开关的事', /音效与语音/.test($(w, '#sayTip').textContent),
    $(w, '#sayTip') && $(w, '#sayTip').textContent);
  w.close();
}

/* --------------------------------------------------------------------------
   C5. 拼音王国内置发音音频
   背景（2026-09-14 实测）：联想小新 Pad 的浏览器**根本没有 speechSynthesis**，
   只靠语音合成的话这台设备就是哑的。所以给拼音配了 46 条 base64 音频，
   真音频优先、语音合成兜底 —— 这里验证"音频这条路真的走通了"。
   -------------------------------------------------------------------------- */
async function testPinyinAudio() {
  console.log('\n[C5] 拼音王国 · 内置发音音频（不依赖系统语音）');
  const FILE = 'modules/pinyin-1/index.html';
  const AUDIO_JS = 'modules/pinyin-1/audio.js';
  const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));

  const packSrc = read(AUDIO_JS);
  ok('C5.1 音频包声明了 window.XYB_PINYIN_AUDIO', packSrc.indexOf('window.XYB_PINYIN_AUDIO') > 0);
  const items = [...packSrc.matchAll(/^ {2}"([^"]+)": "data:audio\/mpeg;base64,([A-Za-z0-9+/=]+)"/gm)]
    .map((m) => ({ t: m[1], len: m[2].length }));
  eq('C5.2 音频条目数 = 46（23 示例词 + 23 例字）', items.length, 46);
  ok('C5.3 每条都不是空壳（base64 长度 > 1000）',
    items.every((i) => i.len > 1000), 'min=' + Math.min(...items.map((i) => i.len)));

  const mod = read(FILE);
  const need = [...new Set([...mod.matchAll(/(?:word|sylWord):\s*'([^']+)'/g)].map((m) => m[1]))];
  const have = new Set(items.map((i) => i.t));
  const missing = need.filter((t) => !have.has(t));
  eq('C5.4 模块里要发音的每个词都有音频', missing.length, 0, '缺：' + missing.join('、'));

  /* 真音频优先：点字母应该走 Audio，而不是语音合成 */
  const g = bootModule(FILE, { scripts: [AUDIO_JS], speech: { mode: 'silent' }, audio: {} });
  await waitMs(40);
  const w = g.w;
  eq('C5.5 页面挂载了音频包', Object.keys(w.XYB_PINYIN_AUDIO || {}).length, 46);
  click(w, $(w, '.lt[data-i="0"]'));
  await waitMs(250);
  ok('C5.6 点字母播放的是内置音频', w.__audio.length >= 1);
  ok('C5.7 走的不是语音合成（设备没语音也能出声）',
    !w.__spoke.some((u) => u.text === '爸爸'),
    w.__spoke.map((u) => JSON.stringify(u.text)).join(','));
  ok('C5.8 命中音频时不给"没声音"提示', !hasClass(w, '#sayTip', 'on'),
    $(w, '#sayTip') && $(w, '#sayTip').textContent);
  click(w, $(w, '#soundCheckBtn'));
  await waitMs(300);
  ok('C5.9 自检里显示音频条数', /46 条/.test(w.document.body.innerHTML));
  eq('C5.10 试读返回码标为 audio（一眼看出走哪条路）', $(w, '#chkWhy').textContent, 'audio');
  w.close();

  /* 被自动播放策略拦下 → 必须说清楚，而不是沉默 */
  const g2 = bootModule(FILE, {
    scripts: [AUDIO_JS], speech: { mode: 'silent' }, audio: { reject: true }
  });
  await waitMs(40);
  click(g2.w, $(g2.w, '.lt[data-i="0"]'));
  await waitMs(300);
  ok('C5.11 音频被自动播放策略拦下时有可见提示',
    hasClass(g2.w, '#sayTip', 'on') && /自动播放/.test($(g2.w, '#sayTip').textContent),
    $(g2.w, '#sayTip') && $(g2.w, '#sayTip').textContent);
  g2.w.close();
}

/* --------------------------------------------------------------------------
   D. 作业模块
   用老师真实发的两天原文当测试用例 —— 解析器最容易在"老师的花式排版"上翻车，
   拿真数据跑才有意义（1️⃣ / ① / 1. / 自愿 / 未来日期 / 明日带回 都覆盖到）。
   -------------------------------------------------------------------------- */
const HW_0918 = `9月18日温馨提示
【数学】今日学习任务：
今天数学课上学习了＞、＜、＝（大于、小于、等于），认识了三种符号，会比较数字的大小，完成了21页三种符号的书写。
🏠回家学习任务：
1. 📝自愿练习＞ ＜ ＝三种符号的书写。
2. 🧩实践小活动：家里找两种物品比一比多少（比如苹果和橘子、积木块），说一说谁多谁少，试着用上大于、小于或者等于讲一讲。
【语文】
今日语文任务：
今天我们学习了语文园地第一课时
1️⃣说一说：【六、八】的笔顺和组词2遍
2️⃣背一背：
一片两片三四片，五片六片七八片。九片十片无数片，飞入芦花都不见。
3️⃣想一想：
"人＋二 天、 ＋十 田、日＋ =目"，你还能说出哪些字可以组合成新字？
【班级通知】
1.计划9 月 20 日（本周日）进行疫苗接种。若孩子如有身体不适，请提前私信我。
2.今天给孩子发了3顶小黄帽，分别是夏款、春秋款、冬款，请家长帮孩子在帽子上写好班级和姓名，方便辨认，避免拿混。`;

const HW_0917 = `9月17日温馨提示
【数学】
课上学习了第19页《几和第几》，区分"几个"和"第几个"的含义。
📝回家学习任务（均为自愿完成）：
1. 练习数字1‑5的规范书写；
2. 把数学书附页（101页）上面的图形剪下来，动手排一排，巩固课堂所学。
💡小提示：剪纸的时候，请家长留意孩子使用剪刀，注意安全。
【班级通知】
1.安全责任书下发给了学生，夹在数学书中了，请明日带回。`;

async function testHomework() {
  console.log('\n' + '#'.repeat(52));
  console.log('# D. 作业模块（老师每天留的作业）');
  console.log('#'.repeat(52));

  const G = runScripts(makeWindow('index.html',
    ['assets/core.js', 'assets/sync.js', 'assets/student.js']));
  await new Promise((r) => setTimeout(r, 60));
  const w = G.w, A = w.XYBApp;

  section('[D1] 解析老师原文（用 9/18 的真实原文）');
  const day = A.homework.parse(HW_0918, '2026-09-18');
  ok('解析出结构', !!day && day.blocks.length >= 3, JSON.stringify(day && day.blocks.map((b) => b.subject)));
  eq('日期取自原文/参数', day.date, '2026-09-18');
  const subs = day.blocks.map((b) => b.subject);
  ok('识别出 数学 / 语文 / 班级通知', subs.indexOf('数学') >= 0 && subs.indexOf('语文') >= 0 && subs.indexOf('班级通知') >= 0,
    subs.join(','));

  const all = [];
  day.blocks.forEach((b) => b.tasks.forEach((t) => all.push({ b, t })));
  ok('数学课后任务 ≥2 条', all.filter((x) => x.b.subject === '数学').length >= 2);
  ok('语文任务 ≥3 条（1️⃣2️⃣3️⃣ 都被拆开）', all.filter((x) => x.b.subject === '语文').length >= 3,
    JSON.stringify(all.filter((x) => x.b.subject === '语文').map((x) => x.t.text)));
  ok('课堂进度被单独抓出来（不是混进任务里）',
    (day.blocks.filter((b) => b.subject === '数学')[0].learned || '').indexOf('数学') >= 0,
    day.blocks.filter((b) => b.subject === '数学')[0].learned);
  ok('"自愿"字样被清掉（孩子端不显示）',
    all.every((x) => String(x.t.text).indexOf('自愿') < 0 && String(x.t.full).indexOf('自愿') < 0),
    JSON.stringify(all.map((x) => x.t.text).filter((t) => t.indexOf('自愿') >= 0)));
  const verbs = all.map((x) => x.t.verb);
  ok('动词被识别出来', verbs.some((v) => v === '写一写') && verbs.some((v) => v === '背一背') &&
    verbs.some((v) => v === '说一说'), verbs.join(','));
  const vax = all.filter((x) => x.t.due === '2026-09-20')[0];
  ok('疫苗那条解析出截止日期 2026-09-20', !!vax, JSON.stringify(all.map((x) => x.t.due)));
  ok('班级通知的条目都归"给家长"',
    all.filter((x) => x.b.subject === '班级通知').every((x) => x.t.forParent));
  ok('孩子任务是短句（≤24 字，能读）',
    all.filter((x) => !x.t.forParent).every((x) => x.t.text.length <= 24),
    JSON.stringify(all.filter((x) => !x.t.forParent).map((x) => x.t.text.length)));
  ok('原文留档', (day.raw || '').indexOf('小黄帽') > 0);

  section('[D2] 解析 9/17（自愿 / 附页 / 明日带回）');
  const d2 = A.homework.parse(HW_0917, '2026-09-17');
  const t2 = [];
  d2.blocks.forEach((b) => b.tasks.forEach((t) => t2.push(t)));
  ok('"（均为自愿完成）"被清掉', t2.every((t) => t.text.indexOf('自愿') < 0 && t.full.indexOf('自愿') < 0),
    JSON.stringify(t2.map((t) => t.text)));
  ok('页码引用被提取出来', t2.some((t) => (t.ref || '').indexOf('101') >= 0),
    JSON.stringify(t2.map((t) => t.ref)));
  ok('"请明日带回"被解析成 2026-09-18', t2.some((t) => t.due === '2026-09-18'),
    JSON.stringify(t2.map((t) => t.due)));

  section('[D3] 孩子端：只显示该我做的事 + 打勾');
  A.homework.upsert(day);
  A.homework.upsert(d2);
  w.XYB_APP.render();
  const homeHTML = $(w, '#hwHomeBox').innerHTML;
  ok('首页出现作业卡', homeHTML.indexOf('hwt') > 0);
  ok('班级通知不显示给孩子', homeHTML.indexOf('小黄帽') < 0 && homeHTML.indexOf('疫苗') < 0);
  ok('首页最多只摆 2 项（不把首页撑长）', $$(w, '#hwHomeBox .hwt').length <= 2,
    String($$(w, '#hwHomeBox .hwt').length));
  const st0 = A.homework.stats('2026-09-18');
  ok('统计里不含家长待办', st0.parentLeft >= 2 && st0.total >= 3, JSON.stringify(st0));

  const firstTick = $$(w, '#hwHomeBox .hwt')[0];
  const tkey = firstTick.getAttribute('data-hw');
  click(w, firstTick);
  await new Promise((r) => setTimeout(r, 30));
  const st1 = A.homework.stats('2026-09-18');
  eq('点一下算完成', st1.done, st0.done + 1);
  ok('角标跟着减少', $(w, '#hwDot').textContent === String(st1.left) || st1.left > 9,
    $(w, '#hwDot').textContent + ' vs ' + st1.left);
  ok('做完的那项从首页卡上消失（首页只留待办）',
    !$$(w, '#hwHomeBox .hwt').some((b) => b.getAttribute('data-hw') === tkey));
  A.homework.toggle('2026-09-18', tkey.split('|')[1], false);
  w.XYB_APP.render();
  eq('取消打勾（在作业视图里可以点回来）', A.homework.stats('2026-09-18').done, st0.done);

  section('[D4] 作业视图与导航');
  w.XYB_APP.state.view = 'homework';
  w.XYB_APP.render();
  ok('作业视图渲染出任务', $$(w, '#hwBox .hwt').length >= 3, String($$(w, '#hwBox .hwt').length));
  ok('有「以前的作业」入口', $(w, '#hwHistory').innerHTML.indexOf('hw-hist-item') > 0);
  ok('桌面导航有作业入口', !!$(w, '#nav-homework'));
  ok('底部 Tab 有作业入口', !!$(w, '#tab-homework'));
  ok('D 段全程无 JS 错误', G.errors.length === 0, G.errors.join(' | '));
  w.close();

  section('[D5] 家长端：粘贴 → 解析预览 → 保存');
  const guard = JSON.stringify({ pin: quickHash('1234'), setAt: Date.now(), fails: 0, lockUntil: 0 });
  const G2 = runScripts(makeWindow('parent.html', ['assets/core.js', 'assets/sync.js', 'assets/parent.js']),
    { 'xyb.v1.guard': guard });
  await new Promise((r) => setTimeout(r, 60));
  const w2 = G2.w, A2 = w2.XYBApp;
  enterGate(w2, '1234');
  await new Promise((r) => setTimeout(r, 30));
  ok('家长端有粘贴框与解析按钮',
    !!$(w2, '#hwRaw') && !!$(w2, '#hwDate') &&
    !!$$(w2, '[data-act="hwParse"]').length);
  /* 必须用"今天"来存：hwPending() 有条 `today - 7 天` 的下限，
     家长待办只列最近一周的作业（更早的不再打扰家长）——
     写死某一天的话，跑测试的日子一过这条用例就会假失败。
     顺带把 MM/DD 也算出来，下面核对列表显示时用。 */
  const td = new Date();
  const today = td.getFullYear() + '-' +
    String(td.getMonth() + 1).padStart(2, '0') + '-' +
    String(td.getDate()).padStart(2, '0');
  const mmdd = today.slice(5).replace('-', '/');
  $(w2, '#hwRaw').value = HW_0918;
  $(w2, '#hwDate').value = today;
  click(w2, $$(w2, '[data-act="hwParse"]')[0]);
  await new Promise((r) => setTimeout(r, 30));
  ok('解析预览列出了每一行', $$(w2, '#hwPreview .hw-row').length >= 5,
    String($$(w2, '#hwPreview .hw-row').length));
  ok('家长专属项默认勾上"给家长"',
    $$(w2, '#hwPreview input[type="checkbox"]').some((c) => c.checked));
  click(w2, $$(w2, '[data-act="hwSave"]')[0]);
  await new Promise((r) => setTimeout(r, 40));
  eq('保存后作业进了本地数据', A2.homework.days().length, 1);
  ok('保存后再看列表：显示这一天', $(w2, '#hwDays').innerHTML.indexOf(mmdd) > 0, mmdd);
  ok('家长待办块出现', $(w2, '#hwDays').innerHTML.indexOf('要爸爸妈妈做的事') > 0);
  ok('家长端全程无 JS 错误', G2.errors.length === 0, G2.errors.join(' | '));
  w2.close();
}

/* -------------------------------------------------------------------------- */
/* E. 视频学堂（视频库：分类 / 播放 / 完成判定）                                  */
/* -------------------------------------------------------------------------- */
async function testVideo() {
  console.log('\n' + '#'.repeat(52));
  console.log('# E. 视频学堂（学科 → 系列 → 集）');
  console.log('#'.repeat(52));

  const FILE = 'modules/video-1/index.html';
  const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));
  const K_DONE = 'xyb.video.done.v1';
  const doneIds = (w) => {
    try { return Object.keys(JSON.parse(w.localStorage.getItem(K_DONE) || '{}')); }
    catch (e) { return []; }
  };
  /* jsdom 里 duration / currentTime 是只读的，直接改属性描述符来模拟播放进度 */
  const setMedia = (el, dur, cur) => {
    Object.defineProperty(el, 'duration', { value: dur, configurable: true });
    Object.defineProperty(el, 'currentTime', { value: cur, writable: true, configurable: true });
  };
  const tick = (w, el) => el.dispatchEvent(new w.Event('timeupdate'));
  const allItems = () => {
    const out = [];
    fakeVideoList().subjects.forEach((g) => g.series.forEach((s) => s.items.forEach((it) => out.push(it))));
    return out;
  };
  /* 找一个视频在界面上的位置：学科下标 + 系列下标 + 集下标 */
  const locate = (id) => {
    const subs = fakeVideoList().subjects;
    for (let k = 0; k < subs.length; k++) {
      for (let si = 0; si < subs[k].series.length; si++) {
        const j = subs[k].series[si].items.findIndex((x) => x.id === id);
        if (j >= 0) return { g: k, si: si, i: j };
      }
    }
    return { g: 0, si: 0, i: 0 };
  };
  /* 确保某个系列是展开的（折叠状态下点不到里面的集） */
  const ensureOpen = async (w, si) => {
    if (!hasClass(w, '.series', 'open') || !$$(w, '.series')[si].classList.contains('open')) {
      click(w, $$(w, '.shead')[si]);
      await waitMs(15);
    }
  };

  section('[E1] 学科与系列（系列默认折叠）');
  const g = bootModule(FILE, { globals: { XYB_VIDEOS: fakeVideoList() } });
  await waitMs(40);
  const w = g.w;

  eq('E1.1 学科 Tab 数 = 学科数', $$(w, '.tab').length, 2);
  ok('E1.2 默认停在第一个学科', hasClass(w, '.tab', 'on'));
  eq('E1.3 列表展示的是「系列」而不是几百集平铺', $$(w, '.series').length, 2);
  eq('E1.4 顶部显示视频总数', $(w, '#allCnt').textContent, '4');
  ok('E1.5 系列名显示正确', $(w, '.shead .sname').textContent.indexOf('拼音儿歌') >= 0,
    $(w, '.shead .sname').textContent);
  ok('E1.6 系列上带集数与已看数', $(w, '.shead .smeta').textContent.indexOf('1 集') >= 0,
    $(w, '.shead .smeta').textContent);
  ok('E1.7 系列默认折叠（108 集全铺开会没法用）', !hasClass(w, '.series', 'open'));
  /* 注意：折叠是靠 CSS（.sbody{display:none}）做的，而 jsdom 不套用样式表，
     直接数 .vcard 会数到 DOM 里的全部（包括折叠的那些）。所以要断言
     "展开的系列里的卡片数"，这既能验证状态、又不依赖 CSS 计算。 */
  eq('E1.8 折叠时看不到里面的集（没有展开的系列）', $$(w, '.series.open .vcard').length, 0);

  section('[E2] 展开系列才看到集');
  click(w, $(w, '.shead'));
  await waitMs(20);
  ok('E2.1 点系列标题会展开', hasClass(w, '.series', 'open'));
  eq('E2.2 展开后看到这一集', $$(w, '.series.open .vcard').length, 1);
  eq('E2.3 卡片上显示时长', $(w, '.vcard .dur').textContent, '5:00');
  click(w, $(w, '.shead'));
  await waitMs(20);
  ok('E2.4 再点一次收起来', !hasClass(w, '.series', 'open'));

  section('[E3] 切学科（只有一个系列时自动展开）');
  click(w, $$(w, '.tab')[1]);
  await waitMs(20);
  eq('E3.1 切学科后换成第二个学科的系列', $$(w, '.series').length, 1);
  ok('E3.2 单系列自动展开，不用多点一次', hasClass(w, '.series', 'open'));
  eq('E3.3 直接能看到该系列的集', $$(w, '.vcard').length, 2);
  ok('E3.4 编码不兼容的有可见标记（否则孩子在 iPad 上只看到黑屏）',
    $(w, '#list').textContent.indexOf('格式可能不支持') > 0);

  section('[E4] 播放');
  click(w, $$(w, '.vcard')[0]);
  await waitMs(60);
  ok('E4.1 播放层打开', !hasClass(w, '#player', 'hide'));
  ok('E4.2 播放层显示当前标题', $(w, '#pTitle').textContent.indexOf('认识图形') >= 0,
    $(w, '#pTitle').textContent);
  ok('E4.3 video 的 src 指向清单里的文件',
    String($(w, '#vid').getAttribute('src') || '').indexOf('/videos/数学/') > 0,
    String($(w, '#vid').getAttribute('src')));

  section('[E5] 看完 90% 才算学会');
  const vid = $(w, '#vid');
  let finishCalls = 0;
  const realFinish = w.XYB.finish;
  w.XYB.finish = function () { finishCalls++; return this; };

  setMedia(vid, 500, 400);                 /* 80% */
  tick(w, vid);
  await waitMs(10);
  eq('E5.1 只看 80% 不算学会', doneIds(w).length, 0);

  setMedia(vid, 500, 450);                 /* 90% */
  tick(w, vid);
  await waitMs(10);
  eq('E5.2 到 90% 才算学会', doneIds(w).length, 1);
  eq('E5.3 顶部"已看"跟着变', $(w, '#seenCnt').textContent, '1');
  ok('E5.4 弹出"看完啦"提示', hasClass(w, '#pdone', 'on'));
  eq('E5.5 还有视频没看，先不给模块结算', finishCalls, 0);

  const inbox = ls(w, 'inbox') || [];
  ok('E5.6 完成度上报给工作台（1/4）',
    inbox.some((x) => x.event === 'progress' && x.data.done === 1 && x.data.total === 4),
    JSON.stringify(inbox.filter((x) => x.event === 'progress')));

  section('[E6] 全部看完才结算模块');
  const items = allItems();
  for (let k = 0; k < items.length; k++) {
    const p = locate(items[k].id);
    if (!hasClass(w, '#player', 'hide')) { click(w, $(w, '#pBack')); await waitMs(15); }
    click(w, $$(w, '.tab')[p.g]);
    await waitMs(15);
    await ensureOpen(w, p.si);
    click(w, $$(w, '.sbody')[p.si].querySelectorAll('.vcard')[p.i]);
    await waitMs(40);
    const v = $(w, '#vid');
    setMedia(v, items[k].sec, Math.round(items[k].sec * 0.95));
    tick(w, v);
    await waitMs(12);
  }
  eq('E6.1 四个都看完', doneIds(w).length, 4);
  eq('E6.2 全部看完才结算（加星只一次）', finishCalls, 1);
  ok('E6.3 顶部提示"全部看完"', $(w, '#subline').textContent.indexOf('全部看完') >= 0,
    $(w, '#subline').textContent);

  section('[E7] 播放失败必须给出可见原因（不能静默）');
  if (!hasClass(w, '#player', 'hide')) { click(w, $(w, '#pBack')); await waitMs(15); }
  click(w, $$(w, '.tab')[1]);
  await waitMs(15);
  await ensureOpen(w, 0);
  click(w, $$(w, '.vcard')[0]);
  await waitMs(40);
  const v2 = $(w, '#vid');
  Object.defineProperty(v2, 'error', { value: { code: 4 }, configurable: true });
  v2.dispatchEvent(new w.Event('error'));
  await waitMs(10);
  ok('E7.1 格式不支持时弹出提示', hasClass(w, '#ptip', 'on'));
  ok('E7.2 提示里点名了 H.264（能照着解决）',
    $(w, '#ptip').textContent.indexOf('H.264') > 0, $(w, '#ptip').textContent.slice(0, 60));
  ok('E7.3 提示里带"重新加载"按钮', $(w, '#ptip').innerHTML.indexOf('data-retry') > 0);

  section('[E8] 空库要有出路（不能白屏）');
  const g2 = bootModule(FILE, { globals: { XYB_VIDEOS: { total: 0, subjects: [] } } });
  await waitMs(40);
  const w2 = g2.w;
  ok('E8.1 没视频时显示空状态', !hasClass(w2, '#empty', 'hide'));
  ok('E8.2 空状态告诉家长该怎么做',
    $(w2, '#emptyMsg').textContent.indexOf('videos/') > 0,
    $(w2, '#emptyMsg').textContent.slice(0, 46));
  ok('E8.3 空状态下不显示学科 Tab', hasClass(w2, '#tabs', 'hide'));

  ok('E 段全程无 JS 错误', g.errors.length === 0, g.errors.join(' | '));
  ok('E 段空库场景也无 JS 错误', g2.errors.length === 0, g2.errors.join(' | '));
  w.XYB.finish = realFinish;
  w.close();
  w2.close();
}

/* -------------------------------------------------------------------------- */
/* [F] 魂师对决 · 5 以内加减法
   测的是"孩子真正看到的"：从题面 DOM 反解正确答案，不依赖模块内部状态。 */
async function testWuhun() {
  console.log('\n' + '#'.repeat(52));
  console.log('# F. 魂师对决 · 5 以内加减法（魂环闯关）');
  console.log('#'.repeat(52));

  const FILE = 'modules/math-wuhun-5/index.html';
  const waitMs = (ms) => new Promise((r) => setTimeout(r, ms));
  const OK_WAIT = 760;      /* 答对后自动进入下一题的延时（模块里是 700ms） */
  const NO_WAIT = 1980;     /* 答错后的延时（模块里是 1900ms） */

  /* 从题面反解答案 */
  const answerOf = (w) => {
    const m = ($(w, '#qText').textContent || '').match(/(\d+)\s*([+\-])\s*(\d+)/);
    if (!m) return null;
    return m[2] === '+' ? (+m[1] + +m[3]) : (+m[1] - +m[3]);
  };
  /* 点一个答案（只点，不等） */
  const tap = (w, ok) => {
    const ans = answerOf(w);
    const v = ok ? ans : (ans === 0 ? 1 : 0);
    click(w, $(w, '#opts [data-v="' + v + '"]'));
    return ans;
  };
  /* 进到对局 */
  const enter = async (w, pickIdx) => {
    click(w, $$(w, '.rc')[pickIdx]);
    await waitMs(20);
    click(w, $(w, '#startBtn'));
    await waitMs(30);
  };

  section('[F1] 选搭档 → 进入对局');
  let g = bootModule(FILE);
  await waitMs(40);
  let w = g.w;
  eq('F1.1 出场 7 位魂师让孩子挑搭档', $$(w, '.rc').length, 7);
  eq('F1.2 没选搭档时"开始对决"不可点', $(w, '#startBtn').disabled, true);
  click(w, $$(w, '.rc')[0]);
  await waitMs(20);
  ok('F1.3 选中的魂师会高亮', $$(w, '.rc')[0].classList.contains('on'));
  eq('F1.4 选完后按钮可点', $(w, '#startBtn').disabled, false);
  click(w, $(w, '#startBtn'));
  await waitMs(30);
  ok('F1.5 进入对局：出题者带姓名与武魂',
    $(w, '#foeName').textContent.length > 0 && $(w, '#foeWu').textContent.length > 0,
    $(w, '#foeName').textContent + '／' + $(w, '#foeWu').textContent);
  ok('F1.6 选的搭档显示在顶部',
    $(w, '#partnerName').textContent.indexOf('墨白') > -1,
    $(w, '#partnerName').textContent);
  eq('F1.7 答案按钮 0~5 六个', $$(w, '#opts .opt').length, 6);
  eq('F1.8 魂环槽 10 个', $$(w, '#rings .ring').length, 10);
  eq('F1.9 一开始魂环一个都没亮', $$(w, '#rings .ring.on').length, 0);

  section('[F2] 全对一轮 → 十万年魂环');
  const seen = [];
  for (let i = 0; i < 10; i++) {
    seen.push(answerOf(w));
    tap(w, true);
    if (i === 0) {
      ok('F2.1 答对立刻点亮 1 枚魂环', $$(w, '#rings .ring.on').length === 1,
        'on=' + $$(w, '#rings .ring.on').length);
      ok('F2.2 答对时角色有台词', $(w, '#say').textContent.length > 0, $(w, '#say').textContent);
    }
    if (i === 2) {
      ok('F2.3 连对 3 题触发"武魂觉醒"', hasClass(w, '#combo', 'on'),
        $(w, '#combo').textContent);
      ok('F2.4 觉醒文案含连对数', /武魂觉醒/.test($(w, '#combo').textContent),
        $(w, '#combo').textContent);
    }
    await waitMs(OK_WAIT);
  }
  await waitMs(120);
  ok('F2.5 每道题的答案都落在 0~5', seen.every((v) => v !== null && v >= 0 && v <= 5),
    JSON.stringify(seen));
  ok('F2.6 10 题答完亮满 10 枚魂环', $$(w, '#rings .ring.on').length === 10,
    'on=' + $$(w, '#rings .ring.on').length);
  eq('F2.7 切到结果页', $(w, '#endView').style.display, 'block');
  ok('F2.8 全对评"十万年魂环"', $(w, '#endRank').textContent.indexOf('十万年魂环') > -1,
    $(w, '#endRank').textContent);
  eq('F2.9 给 3 颗星', $$(w, '#endStars .on').length, 3);
  ok('F2.10 全对时不显示错题清单', $(w, '#wrongList').style.display === 'none');
  ok('F2.11 结果页有"再来一轮"和返回入口',
    !!$(w, '#againBtn') && !!$(w, '.end .btn.ghost'));
  eq('F2.12 上报了 10 次答题', w.XYB.stat().asked, 10);
  eq('F2.13 上报答对 10 次', w.XYB.stat().right, 10);

  section('[F3] 答错时的反馈（要温柔、要看得见）');
  g = bootModule(FILE);
  await waitMs(40);
  w = g.w;
  await enter(w, 1);
  tap(w, false);
  await waitMs(120);
  ok('F3.1 错的选项标红', !!w.document.querySelector('#opts .opt.no'));
  ok('F3.2 正确答案标绿，让孩子看见', !!w.document.querySelector('#opts .opt.ok'));
  ok('F3.3 提示里写出正确答案', $(w, '#sayTip').textContent.indexOf('正确答案是') > -1,
    $(w, '#sayTip').textContent);
  const words = $(w, '#say').textContent + $(w, '#sayTip').textContent;
  ok('F3.4 文案不出现"错了"这类话', !/错了|不对|错啦/.test(words), words.slice(0, 60));
  eq('F3.5 答错不点亮魂环', $$(w, '#rings .ring.on').length, 0);
  ok('F3.6 答错时角色给出鼓励', $(w, '#say').textContent.length > 0);
  await waitMs(NO_WAIT);
  eq('F3.7 答错后自动进入下一题', $(w, '#idx').textContent, '2');
  ok('F3.8 连续答错不会卡住', g.errors.length === 0, g.errors.join(' | '));
  w.close();

  section('[F4] 错 1 题 → 万年魂环 + 错题清单');
  g = bootModule(FILE);
  await waitMs(40);
  w = g.w;
  await enter(w, 2);
  tap(w, false);
  await waitMs(NO_WAIT);
  for (let i = 1; i < 10; i++) { tap(w, true); await waitMs(OK_WAIT); }
  await waitMs(140);
  ok('F4.1 结果页列出答错的题', $(w, '#wrongList').style.display === 'block' &&
    $(w, '#wrongList').textContent.indexOf('再数一数') > -1,
    $(w, '#wrongList').textContent.slice(0, 40));
  ok('F4.2 错题写成完整算式（不是问号）',
    $(w, '#wrongList').textContent.indexOf('?') < 0,
    $(w, '#wrongList').textContent.slice(0, 40));
  ok('F4.3 错 1 题评"万年魂环"', $(w, '#endRank').textContent.indexOf('万年魂环') > -1,
    $(w, '#endRank').textContent);
  ok('F4.4 结果页汇总含答对数与最高连对',
    /答对 9 \/ 10 题/.test($(w, '#endSum').textContent) &&
    /最高连对/.test($(w, '#endSum').textContent),
    $(w, '#endSum').textContent);
  eq('F4.5 总分 9 分', w.XYB.stat().right, 9);

  section('[F5] 再来一轮');
  click(w, $(w, '#againBtn'));
  await waitMs(40);
  eq('F5.1 回到对局', $(w, '#playView').style.display, 'block');
  eq('F5.2 魂环清零重来', $$(w, '#rings .ring.on').length, 0);
  eq('F5.3 题号回到第 1 题', $(w, '#idx').textContent, '1');
  ok('F5.4 轮次之间不残留错题清单', $(w, '#wrongList').style.display === 'none');
  ok('F5 段全程无 JS 错误', g.errors.length === 0, g.errors.join(' | '));
  w.close();

  section('[F6] 立绘：放了就用图，没放自动回落（都不留白）');

  /* (1) 一份肖像都没放 —— jsdom 里 Image 不触发事件，天然走回落分支 */
  g = bootModule(FILE);
  await waitMs(40);
  w = g.w;
  ok('F6.1 没放肖像时选搭档页头像有内容（emoji 兜底）',
    $$(w, '.rc .av').every((el) => el.innerHTML.trim().length > 0));
  await enter(w, 0);
  ok('F6.2 没放肖像时对局页回落到自绘立绘（不留白）',
    !!$(w, '#portrait svg'), $(w, '#portrait').innerHTML.slice(0, 50));
  ok('F6.3 回落时没有报错', g.errors.length === 0, g.errors.join(' | '));
  w.close();

  /* (2) 放了肖像 —— 注入一个会"加载成功"的假 Image */
  let imgNew = 0;
  function FakeImage() {
    imgNew++;
    const self = this;
    this.onload = null;
    this.onerror = null;
    Object.defineProperty(this, 'src', {
      set(v) {
        self._src = v;
        setTimeout(function () { if (self.onload) self.onload(); }, 0);
      },
      get() { return self._src; }
    });
  }
  g = bootModule(FILE, { globals: { Image: FakeImage } });
  await waitMs(80);
  w = g.w;
  ok('F6.4 放了肖像时选搭档页用图片头像',
    !!$(w, '.rc .av img.rc-img'), $(w, '.rc .av').innerHTML);
  await enter(w, 0);
  await waitMs(80);
  ok('F6.5 对局页用的是肖像图片', !!$(w, '#portrait img.pf-img'),
    $(w, '#portrait').innerHTML.slice(0, 70));
  ok('F6.6 图片路径按角色名拼（portraits/<名字>.<ext>）',
    /portraits\/[^"]+\.(jpg|png|webp|jpeg)/.test($(w, '#portrait').innerHTML),
    $(w, '#portrait').innerHTML.slice(0, 90));
  ok('F6.7 每个角色的肖像只探一次（结果有缓存，否则每题都会重发 404）',
    imgNew <= 8, 'new Image() 次数=' + imgNew);
  ok('F6 段全程无 JS 错误', g.errors.length === 0, g.errors.join(' | '));
  w.close();

  section('[F7] 魂环：每个魂师自带 + 答对一圈圈加持');

  /* (1) 每个魂师名字旁有自己的魂环 */
  g = bootModule(FILE);
  await waitMs(40);
  w = g.w;
  await enter(w, 0);                                /* 墨白 */
  const nWhite = $$(w, '#foeRings i').length;
  ok('F7.1 出题魂师名字旁显示他自己的魂环', nWhite >= 2, '墨白=' + nWhite);
  eq('F7.2 开局角色身下还没有已获得的魂环', $$(w, '#ringbed .rr').length, 0);
  ok('F7.3 魂环颜色取自魂环年份色（不是随便一个色）',
    /#(c4b5fd|f59e0b|8b5cf6|111827|dc2626)/i.test($(w, '#foeRings').innerHTML),
    $(w, '#foeRings').innerHTML.slice(0, 80));
  w.close();

  /* (2) 换个搭档 → 自带的魂环数量跟着变（体现各自实力） */
  g = bootModule(FILE);
  await waitMs(40);
  w = g.w;
  await enter(w, 4);                                /* 炎烈，四环 */
  const nFire = $$(w, '#foeRings i').length;
  ok('F7.4 不同魂师自带的魂环数量不同', nFire !== nWhite, '炎烈=' + nFire + ' 墨白=' + nWhite);
  w.close();

  /* (3) 答对 → 角色身下多一圈（这条是用户反馈的核心） */
  g = bootModule(FILE);
  await waitMs(40);
  w = g.w;
  await enter(w, 0);
  tap(w, true);
  await waitMs(260);
  eq('F7.5 答对一题：角色身下多一圈魂环', $$(w, '#ringbed .rr').length, 1);
  eq('F7.6 最新获得的那枚有入场动画', $$(w, '#ringbed .rr.pop').length, 1);
  eq('F7.7 题目卡下方的魂环槽同步点亮一枚', $$(w, '#rings .ring.on').length, 1);
  eq('F7.8 槽里最新那枚也弹入', $$(w, '#rings .ring.just').length, 1);
  ok('F7.9 顶部计数会跳一下（答对要有反馈）', hasClass(w, '#ringCnt', 'bump'),
    'class=' + $(w, '#ringCnt').className);

  await waitMs(OK_WAIT);
  tap(w, true);
  await waitMs(OK_WAIT);
  tap(w, true);
  await waitMs(260);
  eq('F7.10 答对三题：身下已有三圈', $$(w, '#ringbed .rr').length, 3);
  ok('F7.11 越往上越宽（层层叠加的观感）',
    parseFloat($$(w, '#ringbed .rr')[2].style.width) >
    parseFloat($$(w, '#ringbed .rr')[0].style.width),
    $$(w, '#ringbed .rr')[0].style.width + ' vs ' + $$(w, '#ringbed .rr')[2].style.width);
  ok('F7.12 魂环带发光（不是一圈灰线）',
    /box-shadow/.test($(w, '#ringbed').innerHTML));

  /* (4) 继续答对，环随累计数升级颜色 */
  await waitMs(OK_WAIT);
  tap(w, true);
  await waitMs(260);
  eq('F7.13 答对四题：四圈', $$(w, '#ringbed .rr').length, 4);
  ok('F7.14 满四枚升级成百年黄',
    $(w, '#ringbed').innerHTML.indexOf('#f59e0b') > -1,
    $(w, '#ringbed').innerHTML.slice(0, 60));
  ok('F7 段全程无 JS 错误', g.errors.length === 0, g.errors.join(' | '));
  w.close();
}

/* -------------------------------------------------------------------------- */
(async function main() {
  console.log('\n===== 小悦饼学习工作台 · 冒烟测试 =====');
  const seed = await testStudent();
  await testParent(seed);
  await testModules();
  await testPinyinSound();
  await testPinyinAudio();
  await testHomework();
  await testVideo();
  await testWuhun();

  console.log('\n' + '='.repeat(48));
  console.log('通过 ' + pass + ' / ' + (pass + fail));
  if (fail) {
    console.log('\n失败用例：');
    failures.forEach((f) => console.log('  - ' + f));
  } else {
    console.log('全部通过 \u2705');
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试脚本自身崩溃：', (e && e.stack) || e);
  process.exit(2);
});
