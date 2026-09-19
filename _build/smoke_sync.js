/* ==========================================================================
   小悦饼学习工作台 · 多端同步冒烟测试 (smoke_sync.js)
   --------------------------------------------------------------------------
   为什么单独一个文件：同步层的错法和界面层不一样 —— 界面错了一眼能看出来，
   同步错了是"数据悄悄丢了 / 两端悄悄不一致"，只能在真实 DOM 里跑一遍才敢信。

   本文件覆盖：
     D1  口令哈希与 Python 服务端一致性（自己实现的 sha256 必须和 hashlib 对上）
     D2  默认关闭：不记事件、不联网、页脚状态不显示
     D3  首次接入：服务端无数据 → 以本机为基线推一个检查点
     D4  第二台设备（iPad）拉取云端 → 状态收敛
     D5  iPad 产生新数据 → 回流到电脑端（真·双向收敛）
     D6  重传幂等 + 待推送队列能被清空（服务端已落盘但响应丢失的场景）
     D7  断网：事件留本地、界面照常用、有错误提示
     D8  恢复：联网后自动补交
     D9  回滚：gen 递增触发全网重新对齐
     D10 家长端界面：连接 / 状态 / 清空云端 / 快照回退 全流程

   传输层用一个内存假服务端（stub fetch），因为真服务端已由
   _build/test_sync_server.py（44 项）和 _build/e2e_server_pcc.py（22 项）覆盖；
   这里要测的是**浏览器这一侧**的行为。

   运行：
     set NODE_PATH=<jsdom 所在的 node_modules 目录>
     node _build/smoke_sync.js
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nodeHash = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/* 家长端门禁密码哈希（与 parent.js 里的 hashPin 保持一致） */
function quickHash(p) {
  const s = 'xyb::' + p + '::小悦饼';
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/* --------------------------------------------------------------------------
   内存假服务端：只实现 sync.js 会调的那几个接口，语义与 server.py 对齐
   -------------------------------------------------------------------------- */
function makeFakeServer() {
  const S = { gen: 1, rev: 0, keyHash: null, log: [], versions: [], devices: {}, hits: 0 };
  const hash = (k) => nodeHash('xyb::' + k);

  function reply(obj, code) {
    return Promise.resolve({
      ok: !(code >= 400),
      status: code || 200,
      text: () => Promise.resolve(JSON.stringify(obj))
    });
  }

  function fetchImpl(url, opt) {
    S.hits++;
    const u = new URL(url);
    const p = u.pathname;
    const b = opt && opt.body ? JSON.parse(opt.body) : {};
    const auth = (((opt && opt.headers) || {}).Authorization || '').replace('Bearer', '').trim();

    if (p === '/api/ping') return reply({ ok: true, keySet: !!S.keyHash, gen: S.gen, rev: S.rev });
    if (p === '/api/setkey') {
      if (S.keyHash && auth !== S.keyHash) return reply({ ok: false, error: '口令不对', code: 'AUTH' }, 401);
      if (String(b.key || '').length < 4) return reply({ ok: false, error: '口令至少 4 位' }, 400);
      S.keyHash = hash(b.key);
      return reply({ ok: true, set: true });
    }
    if (!S.keyHash) return reply({ ok: false, error: '还没设置家庭口令', code: 'SETUP' }, 401);
    if (auth !== S.keyHash) return reply({ ok: false, error: '家庭口令不对', code: 'AUTH' }, 401);

    if (p === '/api/info') {
      return reply({ ok: true, gen: S.gen, rev: S.rev, devices: S.devices, versions: S.versions.length });
    }
    if (p === '/api/events') {
      const since = parseInt(u.searchParams.get('since') || '0', 10);
      const gen = parseInt(u.searchParams.get('gen') || String(S.gen), 10);
      const evs = gen !== S.gen ? S.log.slice() : S.log.filter((e) => e.rev > since);
      return reply({ ok: true, gen: S.gen, rev: S.rev, count: evs.length, events: evs });
    }
    if (p === '/api/sync') {
      const gen = b.gen || 1, since = b.since || 0;
      const incoming = Array.isArray(b.events) ? b.events : [];
      const seen = new Set(S.log.map((e) => e.id));
      let accepted = 0, dup = 0;
      const ackIds = [];
      incoming.forEach((e) => {
        if (!e || !e.id) return;
        if (seen.has(e.id)) { dup++; ackIds.push(e.id); return; }
        seen.add(e.id);
        S.rev++;
        S.log.push(Object.assign({}, e, { rev: S.rev, gen: S.gen }));
        ackIds.push(e.id);
        accepted++;
      });
      const dev = String(b.device || 'unknown');
      S.devices[dev] = {
        first: (S.devices[dev] || {}).first || 'now',
        last: 'now',
        count: ((S.devices[dev] || {}).count || 0) + accepted
      };
      const back = gen !== S.gen ? S.log.slice() : S.log.filter((e) => e.rev > since);
      return reply({
        ok: true, gen: S.gen, rev: S.rev,
        accepted, duplicated: dup, ackIds,
        count: back.length, events: back
      });
    }
    if (p === '/api/versions') {
      return reply({
        ok: true,
        versions: S.versions.map((v) => ({
          file: 'g1-r' + v.rev + '-20260914-170000-' + v.reason + '.jsonl',
          bytes: 2048, ts: '2026-09-14 17:00:00'
        }))
      });
    }
    if (p === '/api/rollback') {
      const target = parseInt(b.rev || '0', 10);
      S.versions.push({ rev: S.rev, reason: 'before-rollback' });
      S.log = S.log.filter((e) => e.rev <= target);
      S.rev = S.log.length ? S.log[S.log.length - 1].rev : 0;
      S.gen++;
      return reply({ ok: true, gen: S.gen, rev: S.rev, kept: S.log.length });
    }
    if (p === '/api/reset') {
      if (!b.confirm) return reply({ ok: false, error: '需要 confirm:true' }, 400);
      S.versions.push({ rev: S.rev, reason: 'before-reset' });
      S.log = []; S.rev = 0; S.gen++;
      return reply({ ok: true, gen: S.gen, rev: 0 });
    }
    return reply({ ok: false, error: '未知接口 ' + p }, 404);
  }
  return { S, fetch: fetchImpl, hash };
}

/* --------------------------------------------------------------------------
   打开一个页面实例：摘掉 script 标签后按顺序注入（和 smoke_test.js 同一套做法）
   -------------------------------------------------------------------------- */
function openPage(pageFile, scripts, seed, fetchImpl) {
  const html = read(pageFile).replace(/<script[\s\S]*?<\/script>/g, '');
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
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

  if (fetchImpl) w.fetch = fetchImpl;
  if (seed) Object.keys(seed).forEach((k) => w.localStorage.setItem(k, seed[k]));
  ['assets/catalog.js'].concat(scripts).forEach((f) => {
    try { w.eval(read(f)); }
    catch (e) { errors.push(f + ': ' + e.message); }
  });
  return { w, errors, $: (s) => w.document.querySelector(s) };
}

/* ========================================================================== */
(async function main() {
  console.log('\n===== 小悦饼学习工作台 · 多端同步冒烟测试 =====');

  const URLB = 'http://xyb.test';
  const PIN = '1234';
  const srv = makeFakeServer();

  /* ---------------------------------------------------------------- D1-D3 */
  const g1 = openPage('index.html', ['assets/core.js', 'assets/sync.js', 'assets/student.js'],
    null, srv.fetch);
  await wait(60);
  const A1 = g1.w.XYBApp, S1 = g1.w.XYBSync;

  section('[D1] 口令哈希与服务端一致性');
  eq("sha256('abc') 与标准值一致", S1.sha256hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  eq("sha256('') 与标准值一致", S1.sha256hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  eq('sha256 走 utf-8 多字节（中文）', S1.sha256hex('小悦饼'), nodeHash('小悦饼'));
  eq("sha256('xyb::口令') == hashlib.sha256 同式", S1.sha256hex('xyb::' + PIN), srv.hash(PIN));

  section('[D2] 默认关闭：不记事件、不改行为');
  ok('默认 enabled=false', S1.status().enabled === false);
  const boot0 = await S1.boot();
  ok('关闭时 boot 直接跳过（不联网）', !!(boot0 && boot0.skipped));
  eq('关闭时 emit 不记事件', A1.emit('finish', { mid: 'math-calc' }), null);
  eq('关闭时待推送队列为空', A1.outbox().length, 0);
  ok('关闭时孩子端页脚同步状态是隐藏的', g1.$('#syncState').classList.contains('hide'));

  section('[D3] 首次接入：服务端为空 → 以本机为基线');
  A1.onModuleEvent({ id: 'math-calc', event: 'finish', data: { stars: 3 } });
  A1.onModuleEvent({
    id: 'math-calc', event: 'answer',
    data: { correct: false, q: '3+5', answer: '8', my: '9', tag: '20 以内加法' }
  });
  A1.DB.profile.name = '小悦饼';
  A1.DB.save();
  const localStars = A1.stats().stars;
  const localMistakes = A1.mistakes.list({}).length;
  ok('先造出本机数据（星星 + 错题）', localStars > 0 && localMistakes === 1);

  const c1 = await S1.connect(URLB, PIN);
  ok('服务端首次连接会顺手设置口令', c1.setKey === true);
  ok('服务端无数据时不问"以哪边为准"', c1.needChoice === false);
  ok('连接后识别到本机有数据', c1.localHasData === true);

  const act1 = await S1.activate(URLB, PIN, 'local');
  eq('以本机为基线（seed）', act1.mode, 'seed');
  eq('服务端 rev=1（检查点已推上去）', srv.S.rev, 1);
  eq('本机待推送队列已清空', A1.outbox().length, 0);
  eq('本机状态没有被重算弄丢（星星）', A1.stats().stars, localStars);
  eq('本机错题没丢', A1.mistakes.list({}).length, localMistakes);
  ok('开启后孩子端页脚出现同步状态', !g1.$('#syncState').classList.contains('hide'));
  ok('页脚状态显示已同步', g1.$('#syncState').textContent.indexOf('已同步') >= 0,
    g1.$('#syncState').textContent + ' / class=' + g1.$('#syncState').className);
  ok('D1-D3 全程无 JS 错误', g1.errors.length === 0, g1.errors.join(' | '));

  /* ------------------------------------------------------------------- D4 */
  section('[D4] 第二台设备（iPad）拉取云端 → 收敛');
  const g2 = openPage('index.html', ['assets/core.js', 'assets/sync.js'], null, srv.fetch);
  await wait(40);
  const A2 = g2.w.XYBApp, S2 = g2.w.XYBSync;

  const c2 = await S2.connect(URLB, PIN);
  ok('服务端已设过口令，第二台不再设置', c2.setKey === false);
  eq('第二台看到服务端 rev=1', c2.serverRev, 1);
  ok('本机是空的，所以不需要问"以哪边为准"', c2.needChoice === false);
  await S2.activate(URLB, PIN, 'cloud');
  eq('第二台拉到同样的星星数', A2.stats().stars, localStars);
  eq('第二台拉到同样的错题数', A2.mistakes.list({}).length, localMistakes);
  ok('第二台拿到的是同一份错题内容', A2.mistakes.list({})[0].q === '3+5');

  /* -------------------------------------------------------------------- D5 */
  section('[D5] iPad 产生新数据 → 回流到电脑端');
  A2.onModuleEvent({
    id: 'pinyin-1', event: 'answer',
    data: { correct: false, q: 'b 的例字是？', answer: '爸爸', my: '妈妈', tag: '声母 b' }
  });
  eq('iPad 端记下一条待推送事件', A2.outbox().length, 1);
  const f2 = await S2.flush(true);
  ok('iPad 推送成功', f2.ok === true, JSON.stringify(f2));
  eq('服务端 rev=2', srv.S.rev, 2);

  const f1 = await S1.flush(true);
  ok('电脑端拉到新事件', f1.got >= 1, JSON.stringify(f1));
  const keys1 = A1.mistakes.list({}).map((m) => m.key).sort().join(',');
  const keys2 = A2.mistakes.list({}).map((m) => m.key).sort().join(',');
  eq('两端错题本键集合一致（收敛）', keys1, keys2);
  ok('两端错题内容也一致',
    A1.mistakes.list({}).map((m) => m.q).sort().join('|') ===
    A2.mistakes.list({}).map((m) => m.q).sort().join('|'));

  /* -------------------------------------------------------------------- D6 */
  section('[D6] 重传幂等 + 队列能清空（响应丢失场景）');
  const lastEv = srv.S.log[srv.S.log.length - 1];
  A2.setOutbox([JSON.parse(JSON.stringify(lastEv))]);      /* 模拟"重传已落盘的事件" */
  const revBefore = srv.S.rev;
  const fdup = await S2.flush(true);
  eq('服务端 rev 不增长', srv.S.rev, revBefore);
  eq('服务端判定为重复件', fdup.accepted, 0);
  eq('★ 重传队列被清空（否则会永远反复重传）', A2.outbox().length, 0);
  const dupM = A2.mistakes.list({}).find((m) => m.q === 'b 的例字是？');
  eq('被重传的那道错题次数没有被重复计数', dupM && dupM.times, 1);

  /* ---------------------------------------------------------------- D7-D8 */
  section('[D7] 断网：事件留本地、界面照常用');
  const offline = () => Promise.reject(new Error('network down'));
  g2.w.fetch = offline;
  A2.onModuleEvent({ id: 'math-calc', event: 'answer', data: { correct: true, q: '1+1', answer: '2', my: '2' } });
  eq('断网时事件进了本地队列', A2.outbox().length, 1);
  const foff = await S2.flush(true);
  ok('断网时 flush 返回失败而不是抛异常', foff.ok === false, JSON.stringify(foff));
  ok('断网时记下了错误信息', !!S2.status().lastError, S2.status().lastError);
  eq('断网时事件仍保留在本地', A2.outbox().length, 1);

  section('[D8] 恢复联网 → 自动补交');
  g2.w.fetch = srv.fetch;
  const fback = await S2.flush(true);
  ok('恢复后补交成功', fback.ok === true, JSON.stringify(fback));
  eq('补交后队列清空', A2.outbox().length, 0);
  eq('服务端收到那条事件', srv.S.rev, revBefore + 1);
  eq('断网期间的错误状态已清掉', S2.status().lastError, '');

  /* -------------------------------------------------------------------- D9 */
  section('[D9] 回滚：gen 递增触发全网重新对齐');
  const f3 = await S1.flush(true);
  ok('电脑端已同步到最新', f3.ok === true, JSON.stringify(f3));
  const revNow = srv.S.rev, genNow = srv.S.gen;
  const rb = await S1.rollback(revNow - 1);
  eq('服务端 gen 递增（触发全网重新对齐）', srv.S.gen, genNow + 1);
  eq('服务端 rev 回退一条', srv.S.rev, revNow - 1);
  ok('客户端记住了新的 gen', S1.status().gen === genNow + 1, JSON.stringify(S1.status()));
  eq('回滚前留了快照', srv.S.versions.length, 1);
  const f4 = await S1.flush(true);
  ok('回滚后能继续同步', f4.ok === true, JSON.stringify(f4));
  const back2 = await S2.flush(true);
  ok('另一台设备也能继续同步（gen 变了走全量）', back2.ok === true, JSON.stringify(back2));
  ok('D4-D9 全程无 JS 错误', g1.errors.length === 0 && g2.errors.length === 0,
    g1.errors.concat(g2.errors).join(' | '));

  /* ------------------------------------------------------------------- D10 */
  section('[D10] 家长端界面：连接 / 状态 / 清空云端 / 快照回退');
  const srv2 = makeFakeServer();
  const guard = JSON.stringify({ pin: quickHash(PIN), setAt: Date.now(), fails: 0, lockUntil: 0 });
  const g3 = openPage('parent.html', ['assets/core.js', 'assets/sync.js', 'assets/parent.js'],
    { 'xyb.v1.guard': guard }, srv2.fetch);
  await wait(60);
  const w3 = g3.w;

  g3.$('#gatePin').value = PIN;
  g3.$('#gateForm').dispatchEvent(new w3.Event('submit', { bubbles: true, cancelable: true }));
  await wait(40);
  ok('门禁通过后进入家长中心', !g3.$('#app').classList.contains('hide'));
  eq('同步面板初始状态是"未开启"', g3.$('#syncState').textContent, '未开启');
  ok('同步面板里有地址与口令输入框', !!g3.$('#syncUrl') && !!g3.$('#syncKey'));
  ok('地址默认填了内网地址', g3.$('#syncUrl').value.indexOf('8100') > 0, g3.$('#syncUrl').value);

  /* 填地址口令 → 点"连接并开启" */
  g3.$('#syncUrl').value = URLB;
  g3.$('#syncKey').value = PIN;
  g3.$('#syncKey').dispatchEvent(new w3.Event('change', { bubbles: true }));
  const btnConnect = Array.from(w3.document.querySelectorAll('[data-act]'))
    .find((b) => b.getAttribute('data-act') === 'syncConnect');
  ok('找到"连接并开启"按钮', !!btnConnect);
  btnConnect.dispatchEvent(new w3.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(80);
  eq('服务端被设了口令', !!srv2.S.keyHash, true);
  eq('服务端 rev=1（本机作为起点推了检查点）', srv2.S.rev, 1);
  ok('状态胶囊变成正常', g3.$('#syncState').textContent.indexOf('正常') >= 0,
    g3.$('#syncState').textContent + ' / ' + g3.$('#syncState').className);
  ok('详情里显示记录点 rev', g3.$('#syncDetail').innerHTML.indexOf('rev 1') >= 0,
    g3.$('#syncDetail').innerHTML);

  /* 刷新快照 → 此刻还没有快照 */
  Array.from(w3.document.querySelectorAll('[data-act]'))
    .find((b) => b.getAttribute('data-act') === 'syncVersions')
    .dispatchEvent(new w3.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(60);
  ok('没有快照时给的是友好提示', g3.$('#syncVersions').textContent.indexOf('还没有快照') >= 0,
    g3.$('#syncVersions').textContent);

  /* 清空云端 → 确认 → 再刷新快照应该能看到一条 */
  Array.from(w3.document.querySelectorAll('[data-act]'))
    .find((b) => b.getAttribute('data-act') === 'syncResetCloud')
    .dispatchEvent(new w3.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(30);
  const btnResetDo = w3.document.getElementById('doReset') ||
    Array.from(w3.document.querySelectorAll('[data-act]'))
      .find((b) => b.getAttribute('data-act') === 'syncResetDo');
  ok('清空云端前先弹确认（不是直接执行）', !!btnResetDo);
  ok('确认前服务端还没被清', srv2.S.rev === 1, 'rev=' + srv2.S.rev);
  btnResetDo.dispatchEvent(new w3.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(80);
  eq('确认后服务端事件清空', srv2.S.rev, 0);
  eq('服务端 gen 递增', srv2.S.gen, 2);
  eq('清空前留了快照', srv2.S.versions.length, 1);
  ok('界面状态仍然正常（没崩）', g3.$('#syncState').textContent.length > 0);

  Array.from(w3.document.querySelectorAll('[data-act]'))
    .find((b) => b.getAttribute('data-act') === 'syncVersions')
    .dispatchEvent(new w3.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(60);
  ok('快照列表里出现了一条', g3.$('#syncVersions').innerHTML.indexOf('rev 1') >= 0,
    g3.$('#syncVersions').innerHTML);
  const btnRoll = w3.document.querySelector('[data-act="syncRoll"]');
  ok('快照带"回退到这里"按钮', !!btnRoll);
  btnRoll.dispatchEvent(new w3.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(30);
  const btnRollDo = w3.document.querySelector('[data-act="syncRollDo"]');
  ok('回退前先弹确认', !!btnRollDo);
  btnRollDo.dispatchEvent(new w3.MouseEvent('click', { bubbles: true, cancelable: true }));
  await wait(100);
  eq('回退成功且 gen 再次递增', srv2.S.gen, 3);
  ok('回退后界面没崩', g3.$('#syncState').textContent.length > 0);
  ok('家长端全程无 JS 错误', g3.errors.length === 0, g3.errors.join(' | '));

  /* ------------------------------------------------------------------ 汇总 */
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
  console.error('测试脚本自身崩溃：', e);
  process.exit(2);
});
