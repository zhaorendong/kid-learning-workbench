# 小悦饼学习工作台

> **关于名字**：「小悦饼」是本项目的**产品代号**（家里孩子的小名），不含姓氏或真实姓名。
> 仓库里的所有网络地址、账号、口令都是**占位符** —— 真实值放在你自己本机的
> `_build/site.local.json`（已在 `.gitignore` 里）。

小学生的学习内容统一入口：所有知识模块（数独、口算、拼音……）在这里集中呈现，
孩子点开就能学、学完有反馈；家长能看到学习时长、完成情况和错题。

**纯静态、零依赖、零构建**，双击 `index.html` 即可使用；
可选的多端同步（默认关闭）开启后，iPad 和电脑共用同一份学习记录。

---

## 两个页面，物理隔离

| 页面 | 谁用 | 地址 |
|---|---|---|
| **孩子端** | 孩子 | `index.html` — 首页 / 全部课程 / 错题本 / 我的成就 / 📌 作业 |
| **家长端** | 家长 | `parent.html` — 学习明细 / 错题本 / 作业录入 / 内容管理 / 规则设置 / 多端同步 / 数据备份 |

- 孩子端**没有任何家长设置界面**，只在页脚保留一个"🔒 家长入口"链接
- 家长端被 **4~6 位数字密码**挡住，验证通过前不渲染任何数据；连续输错 3 次锁定 60 秒，闲置 15 分钟自动锁回
- 第一次打开 `parent.html` 会让你设置密码。忘记密码：F12 控制台执行
  `localStorage.removeItem('xyb.v1.guard')` 后刷新（学习数据不受影响）

## 怎么跑起来

### 本机试试（最简单）

```bash
python -m http.server 8080
# 浏览 http://127.0.0.1:8080/
```

> 建议**用 HTTP 而不是双击打开**：`file://` 下部分浏览器会隔离跨目录 `localStorage`，
> 导致"模块里学了、工作台没记上"。真要用 `file://`，本项目也做了兼容
> （注册表用 `catalog.js` 而非 JSON，就是为了绕开 CORS）。

### 部署到家里的常驻机器（给孩子用 iPad 访问）

整站是静态文件，丢给任意 nginx 即可。本项目自带一键脚本（Docker + nginx）：

```bash
# 1) 先准备配置：把示例复制成真实配置并填写
cp _build/site.local.example.json _build/site.local.json
#    在里面填 host / host_lan / ssh_user / ssh_password

# 2) 一键部署（上传 + sha256 逐个校验 + 重建容器 + HTTP 验活）
python _build/deploy_pcc.py
```

细节、坑位与故障排查见 **[`docs/运维手册.md`](docs/运维手册.md)**。

## 多端同步（可选，默认关闭）

同一个学习台，iPad 上学的和电脑上学的本来是各记各的。开启同步后两边共用一份记录。

- **默认关闭**：不开的时候事件层完全不工作，页面行为与纯本地版本一模一样，也不联任何网。
- 开关在 **家长端 → ☁️ 多端同步**：填数据服务地址 + 家庭口令 → "连接并开启"。
- 服务端是单文件 Python 服务（`_build/server/server.py`，只用标准库，可跑在任意一台常开的机器上），
  **不做业务合并**，只把事件按到达顺序追加并分配 `rev`；各设备拿同一批事件重算状态，
  所以多端天然收敛，也不会因为"合并规则写错"而静默丢数据。
- 断网照常学习：事件先排队，联网后自动补交（服务端按事件 id 去重，重传不会重复计数）。
- 家长端可以看记录点（rev）、查看快照、回退到任意一次。

设计取舍见 **[`docs/服务端数据同步设计.md`](docs/服务端数据同步设计.md)**。

> ⚠️ 口令哈希走 **HTTP 明文**传输，这是**家庭内网**方案。别把数据服务端口暴露到公网。

## 目录结构

```
.
├── index.html                  孩子端（入口）
├── parent.html                 家长端（带密码门禁）
├── manifest.webmanifest        PWA（可"添加到主屏幕"）
├── assets/
│   ├── app.css                 统一设计令牌与样式（两端共用）
│   ├── core.js                 ★ 核心层：数据 + 业务逻辑 + 错题本 + 作业解析（两端共用）
│   ├── sync.js                 ★ 多端同步层（默认关闭）
│   ├── student.js              孩子端界面
│   ├── parent.js               家长端界面 + 门禁 + 作业录入 + 同步设置
│   ├── catalog.js              ★ 内容注册表（唯一需要维护的目录）
│   ├── xyb-sdk.js              ★ 内容接入 SDK
│   └── icon.svg
├── modules/                    学习内容
│   ├── _template/              新内容模板（复制即开工）
│   ├── math-calc/              口算闪电侠
│   └── pinyin-1/               拼音王国（含 audio.js：46 条内嵌发音音频，真音频优先）
├── 一年级数独/                  已有产物（原位保留，未改动）
├── _build/                     工具脚本（见下表）
│   ├── site_config.py          ★ 部署配置读取（真实值在 site.local.json）
│   └── server/server.py        ★ 多端同步的数据服务
└── docs/                       全部文档（见下方索引）
```

`_build/` 里的脚本：

| 脚本 | 用途 |
|---|---|
| `verify_all.py` | **一键跑完所有验证关卡**（`--full` 加上服务端与线上） |
| `new_module.py` | 建模块骨架 / 写注册表 / 体检（`--check`、`--list`） |
| `check_refs.py` | JS 引用的 id、页面隔离红线、模块 SDK 接入 |
| `smoke_test.js` | jsdom 真实 DOM 冒烟测试（孩子端 / 家长端 / 模块页 / 声音链路） |
| `smoke_sync.js` | 多端同步冒烟测试（两台设备真实收敛、断网补交、重传幂等） |
| `build_pinyin_audio.py` | 为拼音生成发音音频包（edge-tts → 32kbps mp3 → base64 写进 `audio.js`） |
| `verify_pinyin_audio.py` | 把音频包每条 base64 **真解码**校验（时长/非静音/覆盖全部发音词） |
| `verify_qr.py` | 把生成的二维码**真解码**校验内容（不靠"应该是对的"） |
| `test_sync_server.py` | 数据服务 API 测试（本机临时实例） |
| `server/server.py` | 数据服务本体（单文件、只用标准库） |
| `deploy_server.py` | 部署数据服务（上传 + 建计划任务 + 验活） |
| `e2e_server_pcc.py` | 在部署机上做数据服务端到端验证（含清场） |
| `deploy_pcc.py` | 一键部署静态站（上传 + sha256 校验 + 重建容器 + HTTP 验证） |
| `deploy_probe.py` | 只探测部署机：连通性、端口、镜像、已有容器 |
| `verify_http.py` | 只验证线上：特征串、catalog 条目可达性、缓存头、数据服务 |
| `gen_qr.py` | 生成访问二维码 |
| `site_config.py` | 部署配置读取（**所有脚本不再硬编码地址与口令**） |

## 文档索引

| 文档 | 看它解决什么问题 |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | **产品需求**：要做什么、做到什么程度算完成、怎么验收 |
| [`docs/用户手册.md`](docs/用户手册.md) | **给孩子和家长**：怎么用、卡住了怎么办 |
| [`docs/开发手册.md`](docs/开发手册.md) | **改代码前看**：架构、数据模型、事件同步、扩展步骤、验证关卡 |
| [`docs/运维手册.md`](docs/运维手册.md) | **部署和救火**：上线、升级、备份恢复、故障排查 |
| [`docs/模块接入规范.md`](docs/模块接入规范.md) | 新增一个学习内容时遵循的规范（SDK API、字段表、检查清单） |
| [`docs/服务端数据同步设计.md`](docs/服务端数据同步设计.md) | 多端同步为什么这么设计、代价是什么 |
| [`docs/作业模块设计.md`](docs/作业模块设计.md) | 作业模块的需求来源与解析器设计 |
| [`docs/需求评审.md`](docs/需求评审.md) | 历史归档：早期对标与决策过程 |

## 新增一个学习内容

```bash
python _build/new_module.py --id pinyin-2 --title "拼音进阶" --subject 语文 \
       --type practice --emoji "🅿️" --minutes 15 --path "识字与拼音"
# 然后编辑 modules/pinyin-2/index.html 填内容，刷新工作台即可
```

模块页只要加一行 script 就完成接入：

```html
<script src="../../assets/xyb-sdk.js" data-module-id="pinyin-2" data-back="1"></script>
```

详情见 `docs/模块接入规范.md`。

## 改完必须跑的验证

语法检查查不出"事件绑定失效""同步静默丢数据"这类问题（本项目踩过这个坑），
所以改完统一跑一键脚本：

```bash
python _build/verify_all.py            # 静态四关（不需要部署机在线）
python _build/verify_all.py --full     # 再加：服务端 API + 线上终验
```

日志落在 `_build/verify_all.log`。四关分别是：

```bash
python _build/new_module.py --check     # 注册表 ↔ 文件一致性
python _build/check_refs.py             # JS 引用的 id / 页面隔离 / 模块 SDK 接入
node   _build/smoke_test.js             # jsdom 真实 DOM 冒烟（孩子端 + 家长端 + 模块页）
node   _build/smoke_sync.js             # 多端同步冒烟（两台设备 + 假服务端）
```

后两条需要 jsdom，用 `NODE_PATH` 指向装了它的 `node_modules`
（`verify_all.py` 会自动探测常见位置，也可以显式设环境变量）：

```
set NODE_PATH=<jsdom 所在的 node_modules 目录>
```

## 数据说明

学习数据默认全部存在浏览器本地（`localStorage`，命名空间 `xyb.v1.*`），不上传、不联网；
只有开启多端同步后，事件才会发给家里的数据服务。

| 键 | 内容 |
|---|---|
| `xyb.v1.profile` / `settings` | 昵称、头像、星星、连续天数、每日目标、提醒间隔 |
| `xyb.v1.progress` | 每个内容的完成度、时长、正确率、最近学习时间 |
| `xyb.v1.mistakes` | 跨模块错题本（题干、孩子的答案、正确答案、错了几次、是否订正） |
| `xyb.v1.homework` | 每天的作业（老师原文 + 解析出的任务 + 打勾状态） |
| `xyb.v1.log` | 学习流水（进入/离开、时长），最多保留 500 条 |
| `xyb.v1.hidden` | 家长隐藏的内容 |
| `xyb.v1.guard` | 家长密码（哈希后保存） |
| `xyb.v1.cloud` | 同步配置（开关、地址、口令哈希、gen/rev、上次同步时间）—— 关闭同步时不存在 |
| `xyb.v1.outbox` | 待推送事件队列（断网时攒着，联网补交） |
| `xyb.v1.events` | 从服务端拉回来的事件缓存 |
| `xyb.v1.deviceId` / `seq` | 设备标识与事件序号（保证事件 id 全局唯一） |

清理浏览器数据会丢失记录 —— 家长端提供"导出学习数据"（JSON，含错题本），建议定期备份。

## 许可与免责

家庭自用项目，未做多租户、未做公网加固。若你要拿去参考，注意：

- 家长密码是**防孩子**级别，不防有心人
- 数据同步的口令在 HTTP 上传输，请只在可信内网使用
- 孩子的学习数据属于个人信息，请勿公开上传
