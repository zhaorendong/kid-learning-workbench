/* ==========================================================================
   小悦饼学习工作台 · 内容注册表 (catalog)
   --------------------------------------------------------------------------
   ▶ 这是整个工作台唯一需要维护的"目录文件"。
   ▶ 新增一个知识模块 = 放好 HTML + 在下面 modules 数组里加一条。
   ▶ 用 JS 变量而不是 JSON，是为了让 index.html 双击直接打开(file://)
     也能正常工作，不被浏览器 CORS 拦住。
   ▶ 也可以执行：python _build/new_module.py 自动生成条目。
   ========================================================================== */

window.XYB_CATALOG = {
  version: 1,
  updatedAt: '2026-09-14',
  owner: '小悦饼',
  modules: [
    /* ------------------------------ 已上线 ------------------------------ */
    {
      id: 'sudoku-1',
      title: '数独闯关营',
      subtitle: '从零学会 4×4 数独',
      subject: '思维',
      grade: '一年级',
      type: 'lesson',
      tags: ['逻辑推理', '数感', '配套可打印'],
      url: './一年级数独/一年级数独入门教程.html',
      emoji: '🔢',
      color: '#7c6cf5',
      minutes: 20,
      desc: '分步讲解数独规则与推理方法，配动画演示和闯关练习；同目录下还有可打印题库。',
      mode: 'jump',            /* jump=整页打开  embed=iframe 内嵌保留导航 */
      progress: 'manual',      /* sdk=模块上报进度  manual=手动打勾  none=不跟踪 */
      extra: [
        { label: '可打印题库', url: './一年级数独/一年级数独题库（可打印）.docx', emoji: '🖨️' }
      ],
      featured: true,
      path: '逻辑思维',
      pathOrder: 1,
      status: 'ready'
    },

    /* ------------------------------ 规划中 ------------------------------ */
    {
      id: 'math-calc',
      title: '口算闪电侠',
      subtitle: '20 以内加减法 · 限时闯关',
      subject: '数学',
      grade: '一年级',
      type: 'game',
      tags: ['口算', '限时挑战', '错题本'],
      url: './modules/math-calc/index.html',
      emoji: '⚡',
      color: '#f59e0b',
      minutes: 10,
      desc: '20 以内加减法数字键盘闯关，10 题一轮，实时看正确率和用时，错题自动列出。',
      mode: 'jump',
      progress: 'sdk',
      featured: true,
      path: '数感与计算',
      pathOrder: 1,
      status: 'ready'
    },
    {
      id: 'pinyin-1',
      title: '拼音王国',
      subtitle: '声母认读 · 听音拼读闯关',
      subject: '语文',
      grade: '一年级',
      type: 'practice',
      tags: ['拼音', '听音辨字', '发音示范'],
      url: './modules/pinyin-1/index.html',
      emoji: '🅿️',
      color: '#3b82f6',
      minutes: 15,
      desc: '23 个声母点读认形，配听音辨声母与拼读成音节闯关；读不准就点小喇叭反复听。',
      mode: 'jump',
      progress: 'sdk',
      featured: true,
      path: '识字与拼音',
      pathOrder: 1,
      status: 'ready'
    },
    {
      id: 'hanzi-1',
      title: '识字小达人',
      subtitle: '一年级上册生字',
      subject: '语文',
      grade: '一年级',
      type: 'practice',
      tags: ['笔顺', '组词', '听写'],
      url: './modules/hanzi-1/index.html',
      emoji: '✏️',
      color: '#ec4899',
      minutes: 12,
      desc: '笔顺动画 + 组词配对 + 自动报听写，写对得一星，连对三题拿徽章。',
      mode: 'jump',
      progress: 'sdk',
      featured: false,
      path: '识字与拼音',
      pathOrder: 2,
      status: 'planned'
    },
    {
      id: 'english-words',
      title: '单词卡片盒',
      subtitle: '三年级起点 · 图片联想',
      subject: '英语',
      grade: '小学',
      type: 'practice',
      tags: ['间隔重复', '听音', '翻卡'],
      url: './modules/english-words/index.html',
      emoji: '🃏',
      color: '#10b981',
      minutes: 10,
      desc: '按艾宾浩斯节奏安排复习，到期的词才会出现，避免无效重复。',
      mode: 'jump',
      progress: 'sdk',
      featured: false,
      path: '英语启蒙',
      pathOrder: 1,
      status: 'planned'
    },
    {
      id: 'poem-1',
      title: '古诗小剧场',
      subtitle: '必背古诗 · 图文+朗读',
      subject: '语文',
      grade: '小学',
      type: 'lesson',
      tags: ['古诗', '朗读', '画面理解'],
      url: './modules/poem-1/index.html',
      emoji: '🏯',
      color: '#8b5cf6',
      minutes: 8,
      desc: '一句一画面 + 跟读打分 + 填空默写，读完自动进"今日回顾"。',
      mode: 'jump',
      progress: 'sdk',
      featured: false,
      path: '阅读与积累',
      pathOrder: 1,
      status: 'planned'
    },
    {
      id: 'science-1',
      title: '科学小实验',
      subtitle: '在家能做的 10 个实验',
      subject: '科学',
      grade: '小学',
      type: 'lesson',
      tags: ['动手', '观察记录', '安全提示'],
      url: './modules/science-1/index.html',
      emoji: '🔬',
      color: '#06b6d4',
      minutes: 25,
      desc: '每个实验含材料清单、步骤动画、观察记录表和"想一想"提问。',
      mode: 'jump',
      progress: 'manual',
      featured: false,
      path: '探索与动手',
      pathOrder: 1,
      status: 'planned'
    },
    {
      id: 'logic-shapes',
      title: '图形规律屋',
      subtitle: '找规律 · 图形推理',
      subject: '思维',
      grade: '一年级',
      type: 'game',
      tags: ['找规律', '图形', '推理'],
      url: './modules/logic-shapes/index.html',
      emoji: '🔷',
      color: '#f43f5e',
      minutes: 12,
      desc: '拖拽补全规律序列，难度随正确率自动升降。',
      mode: 'jump',
      progress: 'sdk',
      featured: false,
      path: '逻辑思维',
      pathOrder: 2,
      status: 'planned'
    }
  ],

  /* 学科定义：决定首页筛选条和卡片配色 */
  subjects: [
    { name: '语文', emoji: '📖', color: '#3b82f6' },
    { name: '数学', emoji: '➗', color: '#f59e0b' },
    { name: '英语', emoji: '🔤', color: '#10b981' },
    { name: '思维', emoji: '🧩', color: '#7c6cf5' },
    { name: '科学', emoji: '🔬', color: '#06b6d4' },
    { name: '艺术', emoji: '🎨', color: '#ec4899' },
    { name: '综合', emoji: '🌈', color: '#64748b' }
  ],

  /* 类型定义：卡片左上角的小标签 */
  types: {
    lesson:   { label: '讲解', emoji: '📘' },
    practice: { label: '练习', emoji: '📝' },
    game:     { label: '游戏', emoji: '🎮' },
    print:    { label: '可打印', emoji: '🖨️' },
    book:     { label: '读物', emoji: '📚' },
    tool:     { label: '工具', emoji: '🧰' }
  }
};
