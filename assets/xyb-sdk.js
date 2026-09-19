/* ==========================================================================
   小悦饼学习工作台 · 模块接入 SDK  (xyb-sdk.js)
   --------------------------------------------------------------------------
   任何学习模块（已生成的 HTML）只要加一行 script 标签，就能自动接入工作台：
   记录学习时长、上报完成度、上报答题正确率、领取星星。

   【最小接入】
     <script src="../../assets/xyb-sdk.js" data-module-id="math-calc"></script>

   【常用 API】
     XYB.progress(8, 10)              已做 8 题 / 共 10 题
     XYB.answer(true)                 这题答对了   （自动累计正确率）
     XYB.answer(false, '进位加法')     答错了，只带知识点标签
     XYB.answer(false, {              答错了，带上题干 → 自动进工作台错题本
       tag: '进位加法', q: '8 + 7 = ?', answer: 15, my: 16 })
     XYB.finish({ stars: 3 })         整个内容学完
     XYB.speak('八加七等于十五')      朗读（跟随家长端的"音效与语音"开关）
     XYB.exit()                       返回工作台

   【可选属性】
     data-module-id="xxx"   必须与 catalog.js 中的 id 一致
     data-back="1"          自动在右下角注入"返回工作台"悬浮按钮
     data-auto="30"         停留满 30 分钟自动上报一次 finish（防忘记点）

   说明：SDK 只写 localStorage 的 xyb.v1.inbox 队列，工作台下次打开时消费。
        不联网、不上传、无第三方依赖。
   ========================================================================== */
(function () {
  'use strict';

  var NS = 'xyb.v1.';
  var script = document.currentScript || (function () {
    var ss = document.getElementsByTagName('script');
    for (var i = ss.length - 1; i >= 0; i--) if (/xyb-sdk\.js/.test(ss[i].src || '')) return ss[i];
    return null;
  })();

  /* 猜模块 id：优先 data-module-id，其次从路径 modules/<id>/xx.html 推断 */
  function guessId() {
    if (script && script.getAttribute('data-module-id')) return script.getAttribute('data-module-id');
    var seg = location.pathname.split('/').filter(Boolean);
    for (var i = seg.length - 1; i >= 0; i--) {
      if (seg[i - 1] === 'modules') return decodeURIComponent(seg[i]);
    }
    return decodeURIComponent(seg[seg.length - 2] || 'unknown');
  }

  var MID = guessId();
  var FLAGS = {
    back: !!(script && script.getAttribute('data-back')),
    auto: parseInt((script && script.getAttribute('data-auto')) || '0', 10) || 0
  };
  var acc = { asked: 0, right: 0 };
  var finished = false;

  function read(k, d) {
    try { var v = localStorage.getItem(NS + k); return v ? JSON.parse(v) : d; } catch (e) { return d; }
  }
  function write(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) {} }

  function send(event, data) {
    /* 1) 写队列，工作台下次打开时消费（跨页面跳转场景） */
    var q = read('inbox', []);
    if (!Array.isArray(q)) q = [];
    q.push({ id: MID, event: event, data: data || {}, ts: Date.now() });
    if (q.length > 200) q = q.slice(-200);
    write('inbox', q);
    /* 2) 若被 iframe 内嵌，实时通知父页 */
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ __xyb: 1, id: MID, event: event, data: data || {} }, '*');
      }
    } catch (e) {}
  }

  var XYB = {
    id: MID,
    /* 记录一次作答。
       第二参数可以是字符串（知识点标签），也可以是对象：
       { tag, q, answer, my }  —— 带 q 时，答错的题会自动进工作台错题本 */
    answer: function (correct, opt) {
      var o = (typeof opt === 'string') ? { tag: opt } : (opt || {});
      acc.asked++;
      if (correct) acc.right++;
      send('answer', {
        correct: !!correct,
        tag: o.tag || '',
        q: o.q || '',
        answer: o.answer != null ? o.answer : '',
        my: o.my != null ? o.my : '',
        asked: acc.asked, right: acc.right
      });
      return XYB;
    },
    /* 更新进度（已做 / 总数） */
    progress: function (done, total) {
      send('progress', { done: done, total: total });
      return XYB;
    },
    /* 整个内容学完 → 工作台加星、计入家长端报告 */
    finish: function (opt) {
      opt = opt || {};
      if (finished) return XYB;
      finished = true;
      send('finish', {
        stars: opt.stars || 3, score: opt.score != null ? opt.score : null,
        asked: acc.asked, right: acc.right, title: opt.title || document.title
      });
      if (FLAGS.back) XYB.exit(1200);
      return XYB;
    },
    /* 返回工作台；找不到工作台就退回到上一页 */
    exit: function (delay) {
      var back = function () {
        var home = MID === 'unknown' ? '../../index.html' : '../../index.html';
        if (document.referrer && document.referrer.indexOf('index.html') > -1) history.back();
        else location.href = home;
      };
      if (delay) setTimeout(back, delay); else back();
    },
    /* 读取工作台设置（音效开关等） */
    setting: function (key, dflt) {
      var s = read('settings', {});
      return (s && s[key] !== undefined) ? s[key] : dflt;
    },
    /* 朗读一段文字：用浏览器自带的语音合成，不需要联网下载音频。
       受家长端"音效与语音"开关控制。

       ⚠️ 这里要顶住 iOS/Safari 的四个坑（都会**静默不响、不报错**）：
         1. getVoices() 首次调用经常返回空数组（语音库是异步加载的）；
         2. 设备上没有中文语音时，iOS 会拿英文声音去读中文 → 干脆不出声；
         3. cancel() 紧接着 speak() 会把这次朗读丢掉（Queue 卡住）；
         4. 页面没有用户手势时，第一次 speak 会被直接忽略。
       所以：显式挑一个中文语音、cancel 后补 resume、并用 onstart 做看门狗 ——
       超时既没开始也没报错就判为"被静默拦下"，通过 opt.onFail 告诉调用方，
       让界面能给出排查建议，而不是让家长对着没声音的按钮发呆。 */
    voiceList: function () {
      try { return (window.speechSynthesis && window.speechSynthesis.getVoices()) || []; }
      catch (e) { return []; }
    },
    /* 挑一个最合适的中文语音；挑不到返回 null（= 这台设备读不了中文） */
    pickVoice: function (lang) {
      var want = String(lang || 'zh-CN').toLowerCase().replace('_', '-');
      var vs = XYB.voiceList(), exact = null, loose = null, i, v, l;
      for (i = 0; i < vs.length; i++) {
        v = vs[i];
        l = String(v.lang || '').toLowerCase().replace('_', '-');
        if (l === want) {
          if (v.localService) return v;          /* 本地语音优先：离线可用、延迟低 */
          if (!exact) exact = v;
        } else if (!loose && l.indexOf(want.slice(0, 2)) === 0) {
          loose = v;                             /* zh / zh-HK / zh-TW 也能凑合用 */
        }
      }
      return exact || loose || null;
    },
    /* 声音自检用：把"能不能读、拿什么读"一次问清楚 */
    voiceInfo: function () {
      var vs = XYB.voiceList(), zh = [], i;
      for (i = 0; i < vs.length; i++) {
        if (String(vs[i].lang || '').toLowerCase().indexOf('zh') === 0) {
          zh.push(vs[i].name + '（' + vs[i].lang + '）');
        }
      }
      var picked = XYB.pickVoice('zh-CN');
      return {
        supported: XYB.canSpeak(),
        soundOn: !!XYB.setting('soundOn', true),
        total: vs.length,
        zh: zh,
        picked: picked ? picked.name : ''
      };
    },
    speak: function (text, opt) {
      opt = opt || {};
      var noop = function () {};
      var settled = false, tries = 0;
      var maxTries = opt.retry === false ? 1 : 2;
      if (!text) return XYB;
      if (!XYB.setting('soundOn', true)) { (opt.onFail || noop)('off'); return XYB; }
      if (!XYB.canSpeak()) { (opt.onFail || noop)('unsupported'); return XYB; }

      /* 这一次没成功 → 还能再试一次就换个姿势重来，否则如实上报原因。
         为什么要两次：iOS 上"第一次朗读被吞掉"很常见（引擎没被解锁 / 语音库还没就绪），
         第二次不指定 voice、稍微错开时间，往往就出声了。 */
      function fail(why) {
        if (settled) return;
        if (tries < maxTries) { tries++; tryOne(tries); return; }
        settled = true;
        (opt.onFail || noop)(why);
      }

      function tryOne(n) {
        try {
          var synth = window.speechSynthesis;
          if (n === 1) {
            /* 见坑 3：cancel 之后立刻 speak 会被 Safari 丢掉，补一次 resume 把队列解出来 */
            if (synth.speaking || synth.pending) synth.cancel();
            synth.resume();
          }
          var u = new SpeechSynthesisUtterance(String(text));
          u.lang = opt.lang || 'zh-CN';
          u.rate = (opt.rate || 0.85) * (n === 1 ? 1 : 1.06);
          u.pitch = opt.pitch || 1.05;
          var v = XYB.pickVoice(u.lang);
          /* 第二次**不再指定 voice**：iOS 上有时候指定了 voice 反而一声不响 */
          if (v && n === 1) u.voice = v;
          u.onstart = function () { if (settled) return; settled = true; (opt.onStart || noop)(); };
          u.onerror = function () { fail('error'); };
          synth.speak(u);
          setTimeout(function () {
            if (settled) return;
            /* 判断原因时**重新挑一次语音**：语音库是异步加载的，
               说话那一刻可能还是空的，1.2 秒后往往就有了，不能拿当时的结果下结论。 */
            fail(XYB.pickVoice(u.lang) ? 'silent' : 'novoice');
          }, n === 1 ? (opt.timeout || 1200) : (opt.timeout2 || 1500));
        } catch (e) { fail('error'); }
      }

      tries = 1;              /* 第一次尝试 */
      tryOne(1);
      return XYB;
    },
    /* 把"这台设备上跟朗读有关的事实"原样列出来（不做任何结论）。
       用途：面板上出现自相矛盾的推断时，靠它定位真因 —— 只看结论会误判。 */
    diagnostics: function () {
      var d = { hasSynth: false, synthType: 'undefined', utterType: 'undefined',
                voices: 0, standalone: false, ua: '', secure: '' };
      try {
        d.hasSynth = ('speechSynthesis' in window);
        d.synthType = typeof window.speechSynthesis;
        d.utterType = typeof window.SpeechSynthesisUtterance;
        d.voices = XYB.voiceList().length;
      } catch (e) {}
      try {
        d.standalone = !!(window.navigator && window.navigator.standalone);
        if (!d.standalone && window.matchMedia) {
          d.standalone = window.matchMedia('(display-mode: standalone)').matches;
        }
        d.ua = String(window.navigator.userAgent || '').slice(0, 130);
        d.secure = String(window.location.protocol || '');
      } catch (e) {}
      return d;
    },
    /* 当前浏览器能不能朗读（模块可据此隐藏"听一听"按钮） */
    canSpeak: function () {
      try { return 'speechSynthesis' in window; } catch (e) { return false; }
    },
    /* 当前累计正确率 */
    stat: function () { return { asked: acc.asked, right: acc.right }; }
  };

  /* 主动把语音列表拉一次：Safari/iOS 上 getVoices() 首次常常返回空数组，
     要等 voiceschanged 事件之后才有内容。先拉一次 + 订阅事件，
     后面 pickVoice() 才拿得到中文语音。 */
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener('voiceschanged', function () {
        window.speechSynthesis.getVoices();
      });
    }
  } catch (e) {}

  /* iOS 上还有一个隐因：语音引擎要先被"用户手势里的那次朗读"解锁，
     否则后面的朗读会被直接忽略。这里在用户第一次点/摸页面时用一句空白音预热
     （听不见、不打扰），给后面的"听读音"铺路。用 capture 保证它排在其他处理器前面。*/
  try {
    var speechUnlocked = false;
    function unlockSpeech() {
      if (speechUnlocked) return;
      try {
        if (!XYB.setting('soundOn', true)) return;   /* 家长关了音效就别预热了 */
        if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
        speechUnlocked = true;                       /* 真的发出去了才记标志 */
        var w = new SpeechSynthesisUtterance(' ');
        w.lang = 'zh-CN';
        w.volume = 0;
        window.speechSynthesis.speak(w);
      } catch (e) {}
    }
    document.addEventListener('touchstart', unlockSpeech, { capture: true, passive: true });
    document.addEventListener('click', unlockSpeech, { capture: true });
    document.addEventListener('keydown', unlockSpeech, { capture: true });
  } catch (e) {}

  window.XYB = XYB;

  /* ---------------- 自动返回按钮 ---------------- */
  if (FLAGS.back) {
    function inject() {
      if (document.getElementById('xyb-back')) return;
      var b = document.createElement('button');
      b.id = 'xyb-back';
      b.innerHTML = '🏠 返回学习台';
      b.setAttribute('style',
        'position:fixed;right:14px;bottom:14px;z-index:9998;border:0;border-radius:16px;' +
        'padding:12px 18px;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;' +
        'background:linear-gradient(135deg,#4f8ef7,#a855f7);color:#fff;' +
        'box-shadow:0 8px 22px rgba(79,142,247,.42);-webkit-tap-highlight-color:transparent');
      b.onclick = function () { XYB.exit(); };
      document.body.appendChild(b);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
    else inject();
  }

  /* ---------------- 超时自动 finish（防止孩子忘记点完成） ---------------- */
  if (FLAGS.auto > 0) {
    var t0 = Date.now();
    setInterval(function () {
      if (finished) return;
      if (Date.now() - t0 > FLAGS.auto * 60000) XYB.finish({ stars: 2 });
    }, 30000);
  }

  /* 页面隐藏时把进度刷一次（兼容直接关标签页的情况） */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') send('beat', { ts: Date.now() });
  });

  send('ready', { title: document.title, url: location.href });
})();
