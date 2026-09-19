/* 抓取教程页面中所有会被"念出来"的旁白文本（含代码里动态拼接的句子）
 * 做法：在 jsdom 里接管 window.narrate + 假造 setTimeout，
 *       把所有动画按钮点一遍、Flush 掉定时器队列，即可捕获真实运行时会出现的每一句台词。
 * 用法: node collect_texts.js <教程.html> <输出json>
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);

const seen = [];
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));

let timerId = 0;
let queue = [];

const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'), {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(w) {
    w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    // 假时钟：只记录，不真等
    w.setTimeout = (fn, t) => { queue.push({ id: ++timerId, t: t || 0, fn }); return timerId; };
    w.clearTimeout = (id) => { queue = queue.filter(x => x.id !== id); };
  },
});

const { window } = dom;
const { document } = window;

function record(txt) {
  const t = String(txt).trim();
  if (t && !seen.includes(t)) seen.push(t);
}

/* 接管 narrate */
const origNarrate = window.narrate;
window.narrate = function (id, txt, star) { record(txt); return origNarrate(id, txt, star); };

/* 页面加载时已经调用过的（关卡6 reset / 关卡7 init）也补记一次 */
['n1', 'n1b', 'n2', 'n3', 'n3b', 'n4', 'n5', 'n6', 'n7'].forEach(id => {
  const e = document.getElementById(id);
  if (e) record(e.textContent);
});

/* 执行队列里剩余的回调（按时间顺序，嵌套产生的继续追加） */
function flush() {
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    queue.sort((a, b) => a.t - b.t);
    const item = queue.shift();
    try { item.fn(); } catch (e) { errors.push('timer: ' + e.message); }
  }
  queue = [];
}

function click(id) {
  const b = document.getElementById(id);
  if (!b) { errors.push('缺少按钮 ' + id); return; }
  b.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  flush();
}

/* ---- 1. 各动画关卡的按钮 ---- */
['b1', 'b1b', 'b2', 'b3', 'b3b', 'b4', 'b5'].forEach(click);

/* ---- 2. 关卡 6：完整走一遍（含 7 条分步讲解 + 收尾） ---- */
for (let i = 0; i < 10; i++) click('b6next');
click('b6reset');

/* ---- 3. 关卡 7：把每个分支都触发一遍 ---- */
const cells7 = document.getElementById('s7').querySelectorAll('.cell');
const pad = [...document.getElementById('p7').querySelectorAll('button')];
const padOf = (v) => pad.find(b => b.textContent === String(v));
const gridClick = (i) => {
  cells7[i].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  flush();
};
// 3.1 没选格子就点数字
padOf(1).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
flush();
// 3.2 选中空格 → 填对
gridClick(0); padOf(3).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); flush();
// 3.3 再点同一个已填格子 → 点数字
gridClick(0); padOf(1).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); flush();
// 3.4 擦掉
padOf('擦掉').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); flush();
// 3.5 没选格子就点擦掉
document.getElementById('b7reset').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); flush();
padOf('擦掉').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); flush();
// 3.6 点题目给的数字（grid index 2 = (0,2) 有值 4）
gridClick(2);
// 3.7 选中空格 → 填错
gridClick(1); padOf(1).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); flush();
// 3.8 一路填对到通关
const SOL = [[3, 2, 4, 1], [4, 1, 3, 2], [1, 4, 2, 3], [2, 3, 1, 4]];
for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
  gridClick(r * 4 + c);
  const b = padOf(SOL[r][c]);
  b.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  flush();
}

/* ---- 输出 ---- */
const report = {
  count: seen.length,
  totalChars: seen.reduce((a, s) => a + s.length, 0),
  errors,
  texts: seen,
};
fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
console.log('捕获台词数: ' + seen.length + '，总字数: ' + report.totalChars);
if (errors.length) { console.log('--- 错误 ---'); errors.forEach(e => console.log('  ' + e)); }
seen.forEach((t, i) => console.log(String(i + 1).padStart(3) + '. ' + t));
