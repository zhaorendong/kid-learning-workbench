/* 教程页面冒烟测试：真实 DOM 环境下加载页面，检查脚本是否抛错 + 按钮是否真的绑定成功
 * 用法: node smoke_test.js [教程.html]
 * 不传路径时默认取同级上一层的「一年级数独入门教程.html」
 *
 * 注意（2026-09 修订）：原版"一次性连点 7 个按钮再看旁白有没有变"的写法是错的——
 * 页面同一时刻只允许一个动画序列，连点会让前 6 个被 stopAnyAnim() 掐掉，
 * 只有最后一个能跑。正确做法是**点一个、等一个、验一个**。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', '一年级数独入门教程.html');
if (!fs.existsSync(HTML)) {
  console.error('找不到教程文件: ' + HTML);
  process.exit(2);
}
const html = fs.readFileSync(HTML, 'utf8');

const errors = [];
const played = [];        // 记录实际发起过的音频播放
let audioCreated = 0;     // 统计 new Audio() 次数（应复用同一个元素）

const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));
vc.on('log', (...a) => {});
vc.on('warn', (...a) => {});
vc.on('info', (...a) => {});
vc.on('debug', (...a) => {});

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(window) {
    // jsdom 不实现 IntersectionObserver，注入一个空实现（真实浏览器自带）
    window.IntersectionObserver = class {
      constructor() {}
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    // jsdom 不实现媒体播放，桩掉并记录调用
    window.HTMLMediaElement.prototype.play = function () {
      played.push(String(this.getAttribute('src') || ''));
      return Promise.resolve();
    };
    window.HTMLMediaElement.prototype.pause = function () {};
    // 统计 Audio 元素创建次数：全页应复用同一个（iOS 解锁的前提）
    const Orig = window.Audio;
    window.Audio = function () {
      audioCreated++;
      return new Orig();
    };
  }
});

const { window } = dom;
const { document } = window;

const results = [];
function check(name, cond, extra) {
  results.push({ name, pass: !!cond, extra: extra || '' });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function click(id) {
  const b = document.getElementById(id);
  if (!b) return false;
  b.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}

(async function main() {
  /* ---------- 1. 加载无异常 ---------- */
  check('页面加载无 JS 错误', errors.length === 0, errors.join(' | '));

  /* ---------- 2. 各演示网格全部渲染 ---------- */
  const stageIds = ['s1', 's1b', 's2', 's3', 's3b', 's4', 's5', 's6', 's7'];
  for (const id of stageIds) {
    const host = document.getElementById(id);
    const g = host && host.querySelector('.sgrid');
    check(`#${id} 已渲染网格`, !!g, g ? '' : '（未渲染，说明脚本中断）');
    const cells = host ? host.querySelectorAll('.cell').length : 0;
    check(`#${id} 格子数 = 16`, cells === 16, '实际 ' + cells);
  }

  /* ---------- 3. 每个按钮都能触发自己的旁白（点一个等一个） ---------- */
  const btnMap = [
    ['b1', 'n1'], ['b1b', 'n1b'], ['b2', 'n2'], ['b3', 'n3'],
    ['b3b', 'n3b'], ['b4', 'n4'], ['b5', 'n5'],
  ];
  for (const [bid, nid] of btnMap) {
    check(`按钮 #${bid} 存在`, !!document.getElementById(bid));
    const el = document.getElementById(nid);
    const before = el.textContent;
    click(bid);
    await sleep(560);                 // 各序列首个 wait 均 ≤ 400ms
    check(`点击 #${bid} 后 #${nid} 旁白有变化`, el.textContent !== before,
          '如 "' + el.textContent.slice(0, 22) + '"');
  }

  /* ---------- 4. 关卡6「下一步」同步更新 ---------- */
  const prog6 = document.getElementById('prog6');
  const t0 = prog6.textContent;
  click('b6next'); click('b6next');
  check('关卡6 下一步可推进', prog6.textContent !== t0 && /已经填好 2 \/ /.test(prog6.textContent),
        'prog6="' + prog6.textContent + '"');
  click('b6reset');
  check('关卡6 重置可用', prog6.textContent === '' && document.getElementById('b6next').disabled === false);

  /* ---------- 4b. 关卡6 全程走完，棋盘应还原成正确答案 ---------- */
  const DEMO_SOLUTION = [[4, 2, 1, 3], [1, 3, 2, 4], [2, 4, 3, 1], [3, 1, 4, 2]];
  const cells6 = document.getElementById('s6').querySelectorAll('.cell');
  let steps = 0;
  while (!document.getElementById('b6next').disabled && steps < 30) {
    click('b6next');
    steps++;
    if (steps === 7) {
      check('关卡6 填完 7 格后进度显示 7/7', prog6.textContent === '已经填好 7 / 7 格',
            'prog6="' + prog6.textContent + '"');
    }
  }
  const grid6 = [];
  for (let r = 0; r < 4; r++) {
    grid6.push([...cells6].slice(r * 4, r * 4 + 4).map(d => Number(d.textContent) || 0));
  }
  check('关卡6 点击步数 = 8（7 次填空 + 1 次收尾）', steps === 8, '实际 ' + steps + ' 步');
  check('关卡6 走完后棋盘 = 正确答案',
        JSON.stringify(grid6) === JSON.stringify(DEMO_SOLUTION), JSON.stringify(grid6));
  check('关卡6 结束后按钮禁用并提示完成',
        document.getElementById('b6next').disabled === true &&
        document.getElementById('b6next').textContent === '已经完成');

  /* ---------- 5. 关卡7 互动练习：填对 / 计分 / 擦掉 ---------- */
  const s7 = document.getElementById('s7');
  const cells7 = s7.querySelectorAll('.cell');
  cells7[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  check('关卡7 可选中空格', cells7[0].classList.contains('tgt'));

  const padBtns = [...document.getElementById('p7').querySelectorAll('button')];
  const btn3 = padBtns.find(b => b.textContent === '3');
  check('关卡7 数字键盘已生成（4 个数字 + 1 个擦除）', padBtns.length === 5, '按钮数 ' + padBtns.length);
  check('关卡7 找到数字键 3', !!btn3);
  if (btn3) btn3.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  check('关卡7 填对后计数 +1', document.getElementById('c7ok').textContent === '1',
        'c7ok=' + document.getElementById('c7ok').textContent);
  check('关卡7 剩余数减少', document.getElementById('c7left').textContent === '6',
        'c7left=' + document.getElementById('c7left').textContent);

  cells7[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const eraseBtn = padBtns.find(b => b.textContent === '擦掉');
  check('关卡7 有擦除键', !!eraseBtn);
  if (eraseBtn) eraseBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  check('关卡7 擦除后计数回落', document.getElementById('c7ok').textContent === '0',
        'c7ok=' + document.getElementById('c7ok').textContent);

  cells7[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  const btn1 = padBtns.find(b => b.textContent === '1');
  if (btn1) btn1.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  check('关卡7 填错计数 +1', document.getElementById('c7err').textContent === '1',
        'c7err=' + document.getElementById('c7err').textContent);

  /* ---------- 6. 配音数据覆盖度 ---------- */
  const pack = window.__AUDIO__;
  const mapPath = path.join(__dirname, 'audio_map.json');
  if (fs.existsSync(mapPath)) {
    const items = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    check('配音数据包已内嵌', !!pack, pack ? Object.keys(pack).length + ' 条' : '缺失');
    if (pack) {
      const missing = items.filter(it => !(pack[it.text] && pack[it.text][0])).map(it => it.text);
      check(`全部 ${items.length} 句台词都有配音（无哑句）`, missing.length === 0,
            missing.length ? '缺 ' + missing.length + ' 句 → ' + missing.slice(0, 3).join(' / ') : '');
      const zero = items.filter(it => pack[it.text] && !(pack[it.text][1] > 0)).map(it => it.text);
      check('每句配音时长都 > 0', zero.length === 0,
            zero.length ? '异常 ' + zero.length + ' 句 → ' + zero.slice(0, 3).join(' / ') : '');
      const orphan = Object.keys(pack).filter(k => !items.some(it => it.text === k));
      check('没有多余的僵尸音频', orphan.length === 0, orphan.slice(0, 3).join(' / '));
      check('每条配音都是可播放的 mp3 base64',
            Object.values(pack).every(v => /^data:audio\/mpeg;base64,[A-Za-z0-9+/]/.test(v[0].slice(0, 40)) ||
                                           /^[A-Za-z0-9+/=]{40,}$/.test(v[0])),
            '示例前缀 ' + Object.values(pack)[0][0].slice(0, 16));
    }
  } else {
    check('配音数据包已内嵌', !!pack, '（未找到 audio_map.json，跳过覆盖度检查）');
  }

  /* ---------- 7. iOS 音频解锁链路 ---------- */
  check('存在诊断对象 __AUDIO_DIAG__', !!window.__AUDIO_DIAG__);
  check('定义了 NEED_GESTURE_FIRST 判定', typeof window.NEED_GESTURE_FIRST === 'boolean',
        String(window.NEED_GESTURE_FIRST));
  check('全页复用一个 <audio>（iOS 解锁前提）', audioCreated === 1, '实际创建 ' + audioCreated + ' 个');

  // 前面几条断言用的点击已经把音频解锁了，这里把状态打回"未解锁"再验
  const SILENT_MAX = 2000;          // 静音片段 859 字符；真实片段 ≥ 13656
  window.stopAnyAnim();
  window.audioUnlocked = false;
  window.pendingSpeak = '';
  const playedBeforeLock = played.length;

  window.speak('点按钮，一间一间地看。');
  await sleep(80);
  check('解锁前 speak() 不发起播放（只是攒着）', played.length === playedBeforeLock,
        '新增 ' + (played.length - playedBeforeLock) + ' 次');
  check('解锁前把台词记进 pendingSpeak', window.pendingSpeak === '点按钮，一间一间地看。',
        '"' + window.pendingSpeak + '"');

  // 模拟一次真实触摸（capture 阶段的手势监听）
  document.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  await sleep(100);
  check('手势后 audioUnlocked = true', window.audioUnlocked === true);
  check('手势里同步播了一次极短静音片段（解锁用）',
        played.slice(playedBeforeLock).some(s => s.startsWith('data:audio/mpeg;base64,') && s.length <= SILENT_MAX),
        '本段播放 ' + played.slice(playedBeforeLock).map(s => s.length).join('/'));
  await sleep(320);
  check('解锁后自动补播被挡下的那一句',
        played.slice(playedBeforeLock).some(s => s.length > SILENT_MAX),
        '本段播放 ' + played.slice(playedBeforeLock).map(s => s.length).join('/'));

  // 解锁后点按钮应真的发起播放
  const before = played.length;
  click('b3');
  await sleep(560);
  check('解锁后点按钮会播放配音', played.length > before, '新增播放 ' + (played.length - before) + ' 次');
  check('播放的是内嵌音频（data:audio/mpeg;base64）',
        played.slice(before).every(s => s.startsWith('data:audio/mpeg;base64')),
        (played.slice(before)[0] || '(空)').slice(0, 40));
  check('播放计数写进了诊断对象', window.__AUDIO_DIAG__.played > 0,
        'played=' + window.__AUDIO_DIAG__.played);
  if (pack) {
    check('台词较长时动画会自动延后（等念完再走下一步）',
          window.speakRest() > 0, 'speakRest≈' + Math.round(window.speakRest()) + 'ms');
  }

  /* 声音开关：解锁后才是真正的开关 */
  const snd = document.getElementById('sndBtn');
  check('存在声音开关按钮', !!snd);
  if (snd) {
    snd.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    check('点一下可静音', window.VOICE_ON === false && /关/.test(snd.textContent), snd.textContent);
    snd.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    check('再点一下恢复声音', window.VOICE_ON === true && /开/.test(snd.textContent), snd.textContent);
  }

  /* 点旁白框可重听 */
  const n2 = document.getElementById('n2');
  check('旁白框可点击重听', /重听/.test(n2.title || ''), n2.title || '');
  const b2c = played.length;
  n2.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(60);
  check('点旁白框会重放这句', played.length > b2c, '新增 ' + (played.length - b2c) + ' 次');

  /* 连续点两个动画：前一个应被停掉，按钮恢复可用 */
  click('b1');
  const b1 = document.getElementById('b1');
  check('点击动画按钮后按钮暂时禁用', b1.disabled === true);
  click('b3');
  check('启动另一个动画会停掉前一个并恢复其按钮', b1.disabled === false);

  /* ---------- 8. 解锁后补放被拦下的自动播放 ---------- */
  window.stopAnyAnim();                       // 先清掉在跑的序列，避免守卫挡掉
  window.audioUnlocked = false;
  let autoFired = 0;
  window.pendingAutoPlay = () => { autoFired++; };
  window.unlockAudio();
  await sleep(420);
  check('解锁后放行被拦下的自动播放', autoFired === 1, '触发 ' + autoFired + ' 次');
  check('自动播放放行后 pendingAutoPlay 已清空', window.pendingAutoPlay === null);

  report();
})().catch(e => {
  errors.push('测试自身异常: ' + (e && e.stack || e));
  report();
});

function report() {
  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass);
  console.log('='.repeat(58));
  console.log(`冒烟测试：${pass}/${results.length} 通过`);
  console.log('='.repeat(58));
  for (const r of results) {
    console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '   → ' + r.extra : ''));
  }
  if (errors.length) {
    console.log('\n--- 捕获到的 JS 错误 ---');
    errors.forEach(e => console.log('  ' + e));
  }
  console.log('\n结论: ' + (fail.length === 0 && errors.length === 0 ? 'ALL PASS' : 'FAILED'));
  process.exit(fail.length === 0 && errors.length === 0 ? 0 : 1);
}
