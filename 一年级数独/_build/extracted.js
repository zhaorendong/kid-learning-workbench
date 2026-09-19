
/* ==================================================================
   题目数据
   均来自配套题库（程序生成并经双重校验：唯一解 + 可只用
   「只缺一个」和「排除法」两种基础技巧推到底）
   ================================================================== */
/* 完整演示题 —— 4×4 入门 第 01 题 */
const DEMO_PUZZLE = [
  [0,2,0,0],
  [0,0,2,4],
  [2,0,0,1],
  [3,1,4,2]
];
const DEMO_SOLUTION = [
  [4,2,1,3],
  [1,3,2,4],
  [2,4,3,1],
  [3,1,4,2]
];
/* 互动练习题 —— 4×4 入门 第 02 题 */
const PRACTICE_PUZZLE = [
  [0,0,4,0],
  [0,0,3,2],
  [1,0,2,3],
  [2,3,1,0]
];
const PRACTICE_SOLUTION = [
  [3,2,4,1],
  [4,1,3,2],
  [1,4,2,3],
  [2,3,1,4]
];

/* ==================================================================
   基础工具
   ================================================================== */
function el(tag, cls, txt){const e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e;}

/**
 * 创建数独网格
 * @param host 容器
 * @param n    阶数
 * @param br   宫内行数
 * @param bc   宫内列数
 * @param opt  {size, values}
 */
function makeGrid(host, n, br, bc, opt){
  opt = opt || {};
  const size = opt.size || (n===4 ? 62 : n===6 ? 50 : 36);
  host.innerHTML = '';
  const g = el('div','sgrid');
  g.style.gridTemplateColumns = 'repeat('+n+', '+size+'px)';
  g.style.gridTemplateRows    = 'repeat('+n+', '+size+'px)';
  g.style.border = '3px solid var(--gb)';
  const cells = {};
  for(let r=0;r<n;r++){
    for(let c=0;c<n;c++){
      const d = el('div','cell');
      d.style.width = size+'px';
      d.style.height = size+'px';
      d.style.fontSize = Math.round(size*(n===9?0.5:0.52))+'px';
      if(c < n-1) d.style.borderRight  = (c%bc===bc-1) ? '3px solid var(--gb)' : '1px solid var(--gl)';
      if(r < n-1) d.style.borderBottom = (r%br===br-1) ? '3px solid var(--gb)' : '1px solid var(--gl)';
      g.appendChild(d);
      cells[r+','+c] = d;
    }
  }
  host.appendChild(g);
  const api = { el:g, n:n, br:br, bc:bc, size:size, at:(r,c)=>cells[r+','+c], all:()=>cells };
  if(opt.values) api.values(opt.values, opt.given);
  return api;
}

/* 常用操作 */
function clearHL(G, cls){
  Object.values(G.all()).forEach(d=>{
    if(cls) d.classList.remove(cls);
    else d.classList.remove('r-hl','c-hl','b-hl','all-hl','tgt','dim','bad','good');
  });
}
function paintRow(G, r, cls){ for(let c=0;c<G.n;c++) G.at(r,c).classList.add(cls||'r-hl'); }
function paintCol(G, c, cls){ for(let r=0;r<G.n;r++) G.at(r,c).classList.add(cls||'c-hl'); }
function paintBox(G, r, c, cls){
  const r0 = Math.floor(r/G.br)*G.br, c0 = Math.floor(c/G.bc)*G.bc;
  for(let i=r0;i<r0+G.br;i++) for(let j=c0;j<c0+G.bc;j++) G.at(i,j).classList.add(cls||'b-hl');
}
/** 批量设值：vals 二维数组，0 表示空 */
function setValues(G, vals, givens){
  G.n0 = G.n;
  for(let r=0;r<G.n;r++) for(let c=0;c<G.n;c++){
    const d = G.at(r,c), v = vals[r][c];
    d.textContent = '';
    d.className = 'cell' + (v ? (givens && !givens[r][c] ? ' wr' : ' given') : ' blk');
    if(v) d.textContent = v;
    else d.textContent = '';
  }
}
function put(G, r, c, v, cls){
  const d = G.at(r,c);
  d.textContent = v;
  d.className = 'cell ' + (cls||'wr') + ' pop';
  setTimeout(()=>d.classList.remove('pop'), 520);
}
function showCands(G, r, c, list){
  const d = G.at(r,c);
  const box = el('div','cands');
  list.forEach(v=>{
    const s = el('span', null, v);
    s.dataset.v = v;
    box.appendChild(s);
  });
  d.innerHTML = ''; d.appendChild(box);
  d.className = 'cell tgt';
  Object.values(G.all()).forEach(x=>{ if(x!==d) x.classList.add('dim'); });
}

/* 序列播放器 */
function Sequencer(steps, onDone){
  let timers = [];
  return {
    stop(){ timers.forEach(clearTimeout); timers = []; },
    play(){
      this.stop();
      let t = 0;
      steps.forEach(s=>{
        t += (s.wait || 0);
        timers.push(setTimeout(()=>{ try{ s.run && s.run(); }catch(e){ console.error(e); } }, t));
      });
      timers.push(setTimeout(()=>{ onDone && onDone(); }, t + 60));
    }
  };
}
function narrate(id, txt, star){
  const e = document.getElementById(id);
  e.textContent = txt;
  e.className = 'narrate' + (star ? ' star' : '');
}

/* 只在第一次进入视野时自动播放 */
function autoPlayOnce(node, fn){
  const io = new IntersectionObserver(es=>{
    es.forEach(e=>{ if(e.isIntersecting){ io.disconnect(); fn(); } });
  }, {threshold:0.45});
  io.observe(node);
}

/* ==================================================================
   关卡 1：认识数独
   ================================================================== */
(function(){
  const SOL = [[1,2,3,4],[3,4,1,2],[2,1,4,3],[4,3,2,1]];
  const G = makeGrid(document.getElementById('s1'), 4, 2, 2, {values:SOL});
  const N = 'n1';

  const seq = new Sequencer([
    {wait:400,  run:()=>{ narrate(N,'这是一个已经做好的 4×4 数独，数字只有 1、2、3、4 哦。'); }},
    {wait:2200, run:()=>{ clearHL(G); paintRow(G,0); narrate(N,'先看第 1 排：1、2、3、4，每个数字正好出现一次。'); }},
    {wait:2400, run:()=>{ clearHL(G); paintRow(G,1); narrate(N,'第 2 排：3、4、1、2，也是一个不多、一个不少。'); }},
    {wait:2400, run:()=>{ clearHL(G); paintRow(G,2); paintRow(G,3); narrate(N,'第 3 排、第 4 排，都是一样的。'); }},
    {wait:2600, run:()=>{ clearHL(G); paintCol(G,0); narrate(N,'再竖着看第 1 列：1、3、2、4，也是一个都不重复！'); }},
    {wait:2400, run:()=>{ clearHL(G); paintCol(G,3); narrate(N,'第 4 列也是：4、2、3、1，同样不重复。'); }},
    {wait:2600, run:()=>{ clearHL(G); paintBox(G,0,0); narrate(N,'最后看这间小房子（左上角）：1、2、3、4，还是不重复。'); }},
    {wait:2600, run:()=>{ clearHL(G); narrate(N,'横排不重复、竖列不重复、小房子也不重复 —— 这就是数独的全部规则啦！', true); }}
  ], ()=>{ document.getElementById('b1').disabled = false; });

  document.getElementById('b1').addEventListener('click', function(){
    this.disabled = true;
    seq.play();
  });
  autoPlayOnce(document.getElementById('s1'), ()=>{ seq.play(); });
})();

/* ---- 1b. 反例：重复 ---- */
(function(){
  const WRONG = [[1,2,3,4],[3,4,1,2],[2,1,4,3],[4,3,2,2]];
  const G = makeGrid(document.getElementById('s1b'), 4, 2, 2, {values:WRONG});
  const N = 'n1b';

  const seq = new Sequencer([
    {wait:300,  run:()=>{ clearHL(G); narrate(N,'这看起来好像没问题……再仔细看看最后一排。'); }},
    {wait:2400, run:()=>{ clearHL(G); paintRow(G,3); narrate(N,'第 4 排是：4、3、2、2 —— 咦？'); }},
    {wait:2000, run:()=>{
        narrate(N,'两个 2！这样是不行的哦。');
        G.at(3,2).classList.add('bad','shake');
        G.at(3,3).classList.add('bad','shake');
        setTimeout(()=>{ G.at(3,2).classList.remove('shake'); G.at(3,3).classList.remove('shake'); }, 600);
      }},
    {wait:2600, run:()=>{ clearHL(G); narrate(N,'所以记住：同一个数字，在一排里只能出现一次。', true); }}
  ]);
  document.getElementById('b1b').addEventListener('click', ()=>seq.play());
})();

/* ==================================================================
   关卡 2：认识宫
   ================================================================== */
(function(){
  const SOL = [[1,2,3,4],[3,4,1,2],[2,1,4,3],[4,3,2,1]];
  const G = makeGrid(document.getElementById('s2'), 4, 2, 2, {values:SOL});
  const N = 'n2';

  const seq = new Sequencer([
    {wait:300,  run:()=>{ clearHL(G); narrate(N,'这些加粗的黑线，把大格子切成了 4 间小房子。'); }},
    {wait:2500, run:()=>{ clearHL(G); paintBox(G,0,0); narrate(N,'第 1 间：左上角。里面是 1、2、3、4，不重复。'); }},
    {wait:2400, run:()=>{ clearHL(G); paintBox(G,0,3); narrate(N,'第 2 间：右上角。3、4、1、2，也不重复。'); }},
    {wait:2400, run:()=>{ clearHL(G); paintBox(G,3,0); narrate(N,'第 3 间：左下角。2、1、4、3，同样不重复。'); }},
    {wait:2400, run:()=>{ clearHL(G); paintBox(G,3,3); narrate(N,'第 4 间：右下角。4、3、2、1，还是不重复。'); }},
    {wait:2700, run:()=>{ clearHL(G); paintBox(G,0,0); paintRow(G,0); paintCol(G,0);
        narrate(N,'一间小房子有 4 个格子，和"一排"一样多。所以解题时，宫就是我们的好帮手！', true); }}
  ]);
  document.getElementById('b2').addEventListener('click', ()=>seq.play());
  autoPlayOnce(document.getElementById('s2'), ()=>seq.play());
})();

/* ==================================================================
   关卡 3：技巧一 —— 只缺一个
   ================================================================== */
(function(){
  const SOL = [[1,2,3,4],[3,4,1,2],[2,1,4,3],[4,3,2,1]];
  const G = makeGrid(document.getElementById('s3'), 4, 2, 2, {values:SOL});
  const N = 'n3';
  // 先把第 1 排最后一个擦掉
  G.at(0,3).textContent = ''; G.at(0,3).className = 'cell blk';
  G.at(0,0).className = 'cell given';

  const seq = new Sequencer([
    {wait:400,  run:()=>{ clearHL(G); narrate(N,'第 1 排现在是：1、2、3、空。想一想，空格填几？'); }},
    {wait:2600, run:()=>{ clearHL(G); paintRow(G,0); narrate(N,'一排里 1、2、3、4 都要有，且只能有一次。'); }},
    {wait:2400, run:()=>{
        narrate(N,'已经有 1 了 — 不能填 1');
        G.at(0,0).classList.add('good');
      }},
    {wait:1700, run:()=>{ narrate(N,'已经有 2 了 — 不能填 2'); G.at(0,1).classList.add('good'); }},
    {wait:1700, run:()=>{ narrate(N,'已经有 3 了 — 不能填 3'); G.at(0,2).classList.add('good'); }},
    {wait:1900, run:()=>{
        narrate(N,'1、2、3 都被占了，只剩下……4！');
        G.at(0,3).classList.add('tgt','blink');
      }},
    {wait:2000, run:()=>{ G.at(0,3).classList.remove('blink'); put(G,0,3,4,'wr'); narrate(N,'所以这里一定填 4。', true); }}
  ]);
  document.getElementById('b3').addEventListener('click', ()=>seq.play());
  autoPlayOnce(document.getElementById('s3'), ()=>seq.play());

  /* --- 3b：列 --- */
  const G2 = makeGrid(document.getElementById('s3b'), 4, 2, 2, {values:SOL});
  const N2 = 'n3b';
  G2.at(3,2).textContent = ''; G2.at(3,2).className = 'cell blk';
  // 让这一列只缺一个：擦掉后 (0,2)(1,2)(2,2) = 3,1,4 ；缺 2
  const seq2 = new Sequencer([
    {wait:400, run:()=>{ clearHL(G2); narrate(N2,'看第 3 列，从上往下：3、1、4、空。'); }},
    {wait:2300, run:()=>{ clearHL(G2); paintCol(G2,2); narrate(N2,'这一列 1、2、3、4 都要有，而且只能有一次。'); }},
    {wait:2500, run:()=>{
        narrate(N2,'有 3 了、有 1 了、有 4 了 —— 只差 2！');
        G2.at(0,2).classList.add('good'); G2.at(1,2).classList.add('good'); G2.at(2,2).classList.add('good');
        G2.at(3,2).classList.add('tgt','blink');
      }},
    {wait:2300, run:()=>{ G2.at(3,2).classList.remove('blink'); put(G2,3,2,2,'wr'); narrate(N2,'这里填 2，这一列就完整啦。', true); }}
  ]);
  document.getElementById('b3b').addEventListener('click', ()=>seq2.play());
})();

/* ==================================================================
   关卡 4：技巧二 —— 排除法
   ================================================================== */
(function(){
  // 目标格 (0,0)。行0 有 2；列0 有 1；宫0 有 2、3  → 只剩 4
  const BOARD = [
    [0,2,0,0],
    [0,3,0,0],
    [1,0,0,0],
    [0,0,0,0]
  ];
  const G = makeGrid(document.getElementById('s4'), 4, 2, 2, {values:BOARD});
  const N = 'n4';
  const target = G.at(0,0);

  const reset = ()=>{
    clearHL(G);
    Object.values(G.all()).forEach(d=>d.classList.remove('dim'));
    document.querySelectorAll('#s4 .cands span').forEach(s=>s.classList.remove('out','keep'));
    G.at(0,0).classList.add('tgt');
  };

  const seq = new Sequencer([
    {wait:400, run:()=>{
        clearHL(G);
        setValues(G, BOARD);
        showCands(G, 0, 0, [1,2,3,4]);
        narrate(N,'黄色格子可能是 1、2、3、4 中的任何一个。我们一个一个赶走它。');
      }},
    {wait:3000, run:()=>{
        clearHL(G); showCands(G,0,0,[1,2,3,4]);
        paintRow(G,0); G.at(0,0).classList.remove('r-hl'); G.at(0,0).classList.add('tgt');
        narrate(N,'第 ① 步：看它的横排。这一排里有 2 —— 所以不能填 2。');
      }},
    {wait:2200, run:()=>{
        const s = document.querySelector('#s4 .cands span[data-v="2"]');
        s.classList.add('out');
        narrate(N,'把 2 划掉。现在还剩下 1、3、4。');
      }},
    {wait:2600, run:()=>{
        clearHL(G); showCands(G,0,0,[1,2,3,4]);
        paintCol(G,0); G.at(0,0).classList.remove('c-hl'); G.at(0,0).classList.add('tgt');
        narrate(N,'第 ② 步：看它的竖列。这一列里有 1 —— 所以不能填 1。');
      }},
    {wait:2200, run:()=>{
        document.querySelector('#s4 .cands span[data-v="1"]').classList.add('out');
        document.querySelector('#s4 .cands span[data-v="2"]').classList.add('out');
        narrate(N,'把 1 也划掉。现在只剩下 3 和 4。');
      }},
    {wait:2600, run:()=>{
        clearHL(G); showCands(G,0,0,[1,2,3,4]);
        paintBox(G,0,0); G.at(0,0).classList.remove('b-hl'); G.at(0,0).classList.add('tgt');
        narrate(N,'第 ③ 步：看它的小房子。这间房子里有 2 和 3 —— 所以 3 也不能填！');
      }},
    {wait:2500, run:()=>{
        ['1','2','3'].forEach(v=>document.querySelector('#s4 .cands span[data-v="'+v+'"]').classList.add('out'));
        document.querySelector('#s4 .cands span[data-v="4"]').classList.add('keep');
        narrate(N,'1、2、3 全被赶走了，只剩下 4！', true);
      }},
    {wait:2200, run:()=>{
        clearHL(G);
        setValues(G, BOARD);
        Object.values(G.all()).forEach(d=>d.classList.remove('dim'));
        put(G,0,0,4,'wr');
        G.at(0,0).classList.add('grow');
        narrate(N,'所以这个格子一定填 4。这就是排除法！', true);
      }}
  ]);
  document.getElementById('b4').addEventListener('click', ()=>seq.play());
  autoPlayOnce(document.getElementById('s4'), ()=>seq.play());
})();

/* ==================================================================
   关卡 5：技巧三 —— 铅笔小数字
   ================================================================== */
(function(){
  // 目标格 (1,1)：行1 有 1、列1 有 3、宫0 有 1 → 排除 {1,3} → 候选 {2,4}（正好演示"拿不准"）
  const BOARD = [
    [0,0,3,0],
    [1,0,0,0],
    [0,0,0,0],
    [0,3,0,0]
  ];
  const G = makeGrid(document.getElementById('s5'), 4, 2, 2, {values:BOARD});
  const N = 'n5';
  const cands = ()=>document.querySelectorAll('#s5 .cands span');

  const seq = new Sequencer([
    {wait:400, run:()=>{
        clearHL(G); setValues(G, BOARD);
        showCands(G, 1, 1, [2,4]);
        narrate(N,'看这个格子。它的横排里有 1，竖列里有 3，小房子里也有 1。');
      }},
    {wait:3200, run:()=>{
        clearHL(G); setValues(G, BOARD); showCands(G, 1, 1, [2,4]);
        paintRow(G,1); paintCol(G,1); paintBox(G,0,0);
        G.at(1,1).classList.add('tgt');
        narrate(N,'1 和 3 都不能填了 —— 那它可能填 2，也可能填 4，一下子就拿不准了。');
      }},
    {wait:3000, run:()=>{
        cands().forEach(s=>s.classList.add('keep'));
        narrate(N,'这时候就用铅笔，把「可能填的数」小小地写进格子里。写出来，眼睛就看得见啦。');
      }},
    {wait:3400, run:()=>{
        narrate(N,'小数字不是答案，是「待定名单」。等你把旁边格子也标好，线索自己就会跳出来。');
      }},
    {wait:2800, run:()=>{
        clearHL(G); setValues(G, BOARD);
        put(G,1,1,4,'wr'); G.at(1,1).classList.add('grow');
        narrate(N,'比如后来发现这一列里 4 只有这一个位置能放 —— 那就把小数字擦掉，写上 4！', true);
      }}
  ]);
  document.getElementById('b5').addEventListener('click', ()=>seq.play());
  autoPlayOnce(document.getElementById('s5'), ()=>seq.play());
})();

/* ==================================================================
   关卡 6：完整演示（题目数据见页面末尾 DEMO 常量）
   ================================================================== */
(function(){
  const P = DEMO_PUZZLE, S = DEMO_SOLUTION, n = 4;
  const given = P.map(row=>row.map(v=>v?1:0));
  const G = makeGrid(document.getElementById('s6'), n, 2, 2, {values:P});
  const N = 'n6';
  const prog = document.getElementById('prog6');

  // 计算解题顺序（模拟"只缺一个"的推进过程）
  const order = [];
  (function(){
    const g = P.map(r=>r.slice());
    for(let step=0; step<40; step++){
      let moved = false;
      // 行
      for(let r=0;r<n && !moved;r++){
        const miss = [];
        for(let c=0;c<n;c++) if(!g[r][c]) miss.push(c);
        if(miss.length===1){
          const used = new Set(g[r].filter(Boolean));
          for(let v=1;v<=n;v++) if(!used.has(v)){
            g[r][miss[0]] = v; order.push([r,miss[0],v,'第 '+(r+1)+' 排只缺一个数，1、2、3、4 里少了 '+v+'，所以这里填 '+v+'。']); moved=true; break;
          }
        }
      }
      if(moved) continue;
      // 列
      for(let c=0;c<n && !moved;c++){
        const miss = [];
        for(let r=0;r<n;r++) if(!g[r][c]) miss.push(r);
        if(miss.length===1){
          const used = new Set();
          for(let r=0;r<n;r++) if(g[r][c]) used.add(g[r][c]);
          for(let v=1;v<=n;v++) if(!used.has(v)){
            g[miss[0]][c] = v; order.push([miss[0],c,v,'第 '+(c+1)+' 列只缺一个数，它少的是 '+v+'，所以填 '+v+'。']); moved=true; break;
          }
        }
      }
      if(moved) continue;
      // 宫
      for(let b=0;b<4 && !moved;b++){
        const r0 = Math.floor(b/2)*2, c0 = (b%2)*2;
        const miss = [];
        const used = new Set();
        for(let i=r0;i<r0+2;i++) for(let j=c0;j<c0+2;j++){
          if(g[i][j]) used.add(g[i][j]); else miss.push([i,j]);
        }
        if(miss.length===1){
          for(let v=1;v<=n;v++) if(!used.has(v)){
            g[miss[0][0]][miss[0][1]] = v;
            order.push([miss[0][0],miss[0][1],v,'第 '+(b+1)+' 间小房子里也只有一个空格，缺的是 '+v+'，填上 '+v+'。']);
            moved=true; break;
          }
        }
      }
      if(moved) continue;
      // 兜底：排除法推一个
      const g2 = P.map(r=>r.slice());
      let placedNow = false;
      for(let i=0;i<n;i++) for(let j=0;j<n;j++) g2[i][j] = g[i][j];
      outer:
      for(let r=0;r<n;r++) for(let c=0;c<n;c++){
        if(g2[r][c]) continue;
        const used = new Set();
        for(let k=0;k<n;k++){ if(g2[r][k]) used.add(g2[r][k]); if(g2[k][c]) used.add(g2[k][c]); }
        const r0 = Math.floor(r/2)*2, c0 = Math.floor(c/2)*2;
        for(let i=r0;i<r0+2;i++) for(let j=c0;j<c0+2;j++) if(g2[i][j]) used.add(g2[i][j]);
        const cands = [];
        for(let v=1;v<=n;v++) if(!used.has(v)) cands.push(v);
        if(cands.length===1){
          g[r][c] = cands[0];
          order.push([r,c,cands[0],'横排、竖列、小房子都看一遍，1、2、3、4 里只剩 '+cands[0]+' 没出现过，就在这里填 '+cands[0]+'。']);
          placedNow = true;
          break outer;
        }
      }
      if(!placedNow) break;
    }
  })();

  let idx = 0;
  const maxStep = order.length;
  const narr = (msg, star)=>narrate(N, msg, star);

  function renderStep(i){
    setValues(G, P);
    G.at(0,0).classList.remove();
    clearHL(G);
    for(let k=0;k<i;k++){
      const [r,c,v] = order[k];
      put(G, r, c, v, 'wr');
      G.at(r,c).classList.remove('pop');
    }
    if(i>0){
      const [r,c] = order[i-1];
      G.at(r,c).classList.add('good');
    }
    prog.textContent = '已经填好 ' + i + ' / ' + maxStep + ' 格';
  }

  function reset(){
    idx = 0;
    setValues(G, P);
    clearHL(G);
    G.at(0,0).classList.add('tgt');
    narr('这是我们的题目，灰色空格一共有 ' + maxStep + ' 个。按下"下一步"我们一起做。');
    prog.textContent = '';
    document.getElementById('b6next').disabled = false;
    document.getElementById('b6next').textContent = '下一步 ▶';
  }

  document.getElementById('b6next').addEventListener('click', function(){
    if(idx >= maxStep){
      setValues(G, S);
      narr('全部填完，检查一下：每一排、每一列、每间房子，1、2、3、4 都没有重复。做对啦！', true);
      prog.textContent = '完成 ' + maxStep + ' / ' + maxStep + ' 格';
      this.disabled = true;
      this.textContent = '已经完成';
      return;
    }
    const [r,c,v,msg] = order[idx];
    idx++;
    renderStep(idx);
    clearHL(G);
    paintRow(G, r, 'r-hl');
    paintCol(G, c, 'c-hl');
    paintBox(G, r, c, 'b-hl');
    G.at(r,c).classList.add('tgt');
    narr(msg);
  });
  document.getElementById('b6reset').addEventListener('click', reset);
  reset();
})();

/* ==================================================================
   关卡 7：互动练习
   ================================================================== */
(function(){
  const P = PRACTICE_PUZZLE, S = PRACTICE_SOLUTION, n = 4;
  const G = makeGrid(document.getElementById('s7'), n, 2, 2, {values:P});
  const pad = document.getElementById('p7');
  const N = 'n7';
  let sel = null, ok = 0, err = 0;
  const blanks = [];
  for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(!P[r][c]) blanks.push([r,c]);
  const need = blanks.length;

  function refreshCount(){
    document.getElementById('c7ok').textContent = ok;
    document.getElementById('c7left').textContent = need - ok;
    document.getElementById('c7err').textContent = err;
  }
  function clearSel(){
    if(sel){ G.at(sel[0],sel[1]).classList.remove('tgt'); }
    sel = null;
  }
  function isFilled(r,c){ return G.at(r,c).textContent !== ''; }

  function init(){
    ok = 0; err = 0; sel = null;
    setValues(G, P);
    refreshCount();
    document.getElementById('win7').innerHTML = '';
    narrate(N, '先点一个空格，再点下面的数字。');
  }

  // 数字键盘
  for(let v=1;v<=n;v++){
    const b = el('button', null, v);
    b.addEventListener('click', ()=>{
      if(!sel){ narrate(N,'先点一个空格，再点数字哦。'); return; }
      const [r,c] = sel;
      if(isFilled(r,c)){ narrate(N,'这个格子已经填啦，换一个吧。'); return; }
      if(S[r][c] === v){
        put(G, r, c, v, 'wr');
        G.at(r,c).classList.add('good');
        ok++; clearSel(); refreshCount();
        if(ok === need){
          document.getElementById('win7').innerHTML =
            '<div class="win">★ 太棒了！全部填对了！你已经会解数独啦 ★</div>';
          narrate(N, '完全正确！你做完了这一整道题。', true);
        }else{
          narrate(N, '答对啦！继续找下一个空格。');
        }
      }else{
        err++;
        const d = G.at(r,c);
        d.textContent = v; d.classList.add('bad','shake');
        setTimeout(()=>{ d.classList.remove('shake'); d.textContent=''; d.className='cell blk'; }, 700);
        refreshCount();
        narrate(N, '唔，再想一想。看看这一排、这一列、还有小房子里都有什么数字？');
      }
    });
    pad.appendChild(b);
  }
  const eb = el('button','erase','擦掉');
  eb.addEventListener('click', ()=>{
    if(!sel) return;
    const [r,c] = sel;
    if(S[r][c] !== 0 && P[r][c] !== 0){ narrate(N,'这是题目给的数字，不能擦哦。'); return; }
    G.at(r,c).textContent=''; G.at(r,c).className='cell blk';
    ok = Math.max(0, ok-1); refreshCount();
    narrate(N,'擦掉了，重新想一想。');
  });
  pad.appendChild(eb);

  // 网格点击
  G.el.addEventListener('click', e=>{
    const i = Array.prototype.indexOf.call(G.el.children, e.target);
    if(i < 0) return;
    const r = Math.floor(i/n), c = i%n;
    if(P[r][c]){ narrate(N,'这个数字是题目给好的，不用填。'); return; }
    clearSel();
    sel = [r,c];
    G.at(r,c).classList.add('tgt');
    narrate(N,'选好了，点下面的数字填进去。');
  });

  document.getElementById('b7reset').addEventListener('click', init);
  init();
})();

/* ==================================================================
   关卡 3 / 5 的静态补充：已在上方完成
   ================================================================== */
