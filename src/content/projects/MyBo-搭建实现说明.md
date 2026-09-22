---
title: "MyBo 搭建实现说明"
description: "记录 MyBo 从技术选型到部署的完整实现过程"
date: 2026-09-19
status: "completed"
tags: ["AI", "Agent"]
featured: true
---

# MyBo 搭建实现说明

> **本文讲什么**：MyBo 这个站是**怎么搭出来的**——技术选型、分层设计、关键决策与取舍、踩过的坑。
>
> **本文不讲什么**：日常怎么跑、怎么发文章。那部分见配套文档《MyBo — 项目说明与运行指南》。两份文档是互补关系，一份写"为什么这样设计"，一份写"每天怎么操作"。
>
> 写作时点：2026-09-19 · 对应代码状态：master 分支 `4c4adf4`

---

## 0. 先给结论

MyBo 的技术本质可以用一句话说清：

> **一个零运行时 JS 的静态站点，用 Content Collections 做内容层，用 Astro 组件做视图层，用 CSS 设计令牌做视觉层，三层的接口窄到只有"一个 md 文件"这么宽。**

具体表现为三件事：

1. **新增内容 = 新增一个 md 文件**，不碰任何页面代码，路由和列表自动出现。
2. **构建产物是 N 个 HTML + 1 个 CSS**（N = 8 个固定页面 + 内容条目数），没有 JS chunk（整站脚本都是内联的，没有岛屿组件）。
3. **视觉全部走设计令牌**（`@theme` 里的 `--color-mybo-*`），改风格是改一组变量，不是逐页改 class。

整站目前 8 个路由定义、3 个内容集合、12 个组件、约 40 个源文件；内容当前是 3 个项目 / 1 个实验 / 1 篇笔记，因此构建出 10 个 HTML。

---

## 1. 项目定位 → 反推出三条硬约束

MyBo 是「个人 AI 实验室与智能系统中枢」，核心循环 `Explore → Build → Use → Learn → Share → Iterate`。它明确不是一个博客，而是**能长期演进的技术基础设施**。

这个定位直接反推出三条约束。**后面所有的技术决策都服从这三条**，遇到分歧时回来看它们：

| 约束 | 含义 | 直接后果 |
| --- | --- | --- |
| **内容与页面分离** | 新增项目/实验/笔记只写 md，不改页面代码 | 必须用 Content Collections，不能把内容硬编码进 `.astro` |
| **先结构后视觉** | 先跑通路由与数据流，再统一美化 | 骨架和设计系统分两次提交，不混在一起改 |
| **可运行 / 可构建 / 可回退** | 每个阶段结束时 `npm run build` 必须绿 | 每次改动都走「改 → 验证 → build → commit」闭环 |

---

## 2. 技术选型与「放弃了什么」

选型的重点是**放弃**——记录下当时否掉了哪些路，以后才不会反复。

| 层面 | 选择 | 版本 | 放弃的方案 | 放弃原因 |
| --- | --- | --- | --- | --- |
| 框架 | Astro | `^7.3.2` | Next.js / Nuxt | 纯内容站不需要 Node 运行时与 SSR 复杂度；Astro 默认输出零 JS |
| 框架 | — | — | 手写多页 HTML | 8 个页面各自维护导航与页脚，改一次要改八处，必然崩 |
| 样式 | Tailwind CSS | `^4.3.3` | UI 组件库（shadcn 等） | 视觉要极简单色，组件库的默认外观反而是负担 |
| 样式加载 | `@tailwindcss/vite` 插件 | 同版本 | `@astrojs/tailwind` | Tailwind v4 起官方推荐挂 Vite 插件 |
| 样式 | 本地构建 CSS | — | Tailwind Play CDN | 生产环境不推荐，且国内加载不稳定 |
| 内容 | Markdown + Content Collections | `glob` loader | MDX | 当前内容没有嵌入组件的需求，md 更轻；MDX 集成已装好，要用只需改后缀 |
| 类型 | TypeScript | — | 纯 JS | schema 与组件 Props 全部类型化，改字段时编辑器直接报错 |
| 部署 | GitHub + Cloudflare Pages | — | Vercel / 自建服务器 | 静态站免费额度足够，且便于以后挂 `mybo.bot` 与私有服务分流 |

**环境要求**：`package.json` 里写死了 `"engines": { "node": ">=22.12.0" }`。当前开发机实际使用的版本见《运行指南》，只要不低于 22.12 即可。

---

## 3. 搭建时间线：五步走

真实的 commit 顺序就是搭建顺序，比任何事后总结都可靠：

```
4c4adf4  updata page 适配手机      ← 第 5 步：移动端适配
1c99bc4  updata page               ← 第 4 步：设计系统落地（视觉统一）
254e369  test: verify auto deployment  ← 第 3 步：验证 Cloudflare Pages 自动部署
ba6e534  feat: build MyBo website foundation  ← 第 2 步：内容骨架 + 8 个路由
b522c28  "Initial commit from Astro"          ← 第 1 步：脚手架初始化
```

**第 1 步 · 初始化**
用 Astro 官方脚手架生成基础工程，得到 `package.json` / `astro.config.mjs` / `tsconfig.json` / `.gitignore` 和一个示例页。这一步的产物基本被后续全部替换，唯一值得保留的认知是：**先让它能跑，再谈结构**。

**第 2 步 · 内容骨架**
定义三个内容集合、写 `content.config.ts`、建 8 条路由、写第一篇内容。这一步结束时站能跑，视觉是裸的——这是有意的。

**第 3 步 · 接上部署链路**
推到 GitHub（`origin = https://github.com/bdhjh/mybo.git`，主分支 `master`），接 Cloudflare Pages 并验证自动部署可用。**把部署放在视觉之前**，是为了让后面每一次改动都能立刻看到一个线上可回退的版本。

**第 4 步 · 设计系统**
把散落的样式收拢成一套令牌与公共构件（`.shell` / `.eyebrow` / `.prose-mybo`），拆出 12 个组件，8 个页面统一改造。

**第 5 步 · 移动端适配**
按 `<640px` 的断点做整体降档，导航改为小屏两行，处理安全区与触屏交互。

---

## 4. 目录结构（分层视角）

```
D:\Projects\mybo\
├── public/
│   ├── logo.png                        导航品牌标（蓝→橙 MB monogram，透明底）
│   ├── favicon.svg / favicon.ico / apple-touch-icon.png   静态直出资源
├── src/
│   ├── content/                         ── ① 内容层：只放 md
│   │   ├── projects/*.md               当前 3 篇（mybo / 搭建实现说明 / SZCCF 项目案例）
│   │   ├── experiments/first-ai-automation.md
│   │   └── notes/why-mybo.md
│   ├── content.config.ts                ── 内容层的"表结构"定义
│   │
│   ├── i18n/                            ── ② 文案层
│   │   ├── ui.ts                        界面固定文案字典（zh/en）
│   │   └── content-en.ts                内容的英文层（title/desc/正文 HTML）
│   ├── utils/date.ts                    ── 日期与计数：一份数据出中英两套文案
│   │
│   ├── components/                      ── ③ 视图层：可复用积木
│   │   ├── Nav.astro  Footer.astro
│   │   ├── SectionHeading.astro  PageHead.astro
│   │   ├── ProjectCard.astro  ExperimentItem.astro  NoteItem.astro
│   │   ├── StatusBadge.astro  Tag.astro  LangToggle.astro
│   │   └── Welcome.astro                ⚠ 模板残留，未使用
│   ├── layouts/Layout.astro             ── 全站唯一外壳（含 i18n 脚本）
│   ├── styles/global.css                ── ④ 视觉层：Tailwind + 设计令牌
│   ├── pages/                           ── ⑤ 路由层
│   │   ├── index.astro
│   │   ├── about.astro
│   │   ├── projects/{index,[slug]}.astro
│   │   ├── experiments/{index,[slug]}.astro
│   │   └── notes/{index,[slug]}.astro
│   └── assets/                          ⚠ 模板残留（astro.svg / background.svg / hero 图）
├── astro.config.mjs                     Astro + Tailwind + MDX 接线
├── package.json
└── tsconfig.json
```

分层的意义在于：**每一层只向下依赖**。内容层不知道视图层的存在；视图层不知道具体某篇文章叫什么名字；视觉层不认识任何业务概念。所以这五层可以独立改动。

---

## 5. 内容层：Content Collections 是整个设计的支点

### 5.1 集合定义

`src/content.config.ts` 定义三个集合，全部使用 `glob` loader：

```ts
const projects = defineCollection({
	loader: glob({ base: './src/content/projects', pattern: '**/*.md' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		date: z.coerce.date(),
		status: z.enum(['active', 'completed', 'archived']).default('active'),
		tags: z.array(z.string()).default([]),
		featured: z.boolean().default(false),
	}),
});
```

三个集合的 schema 对照：

| 字段 | projects | experiments | notes | 说明 |
| --- | --- | --- | --- | --- |
| `title` | ✅ string | ✅ string | ✅ string | 必填 |
| `description` | ✅ string | ✅ string | ✅ string | 必填，列表页摘要来源 |
| `date` | ✅ date | ✅ date | ✅ date | 用 `z.coerce.date()` 吃下 `2026-09-16` 这种写法 |
| `status` | `active\|completed\|archived`（默认 active） | `idea\|running\|completed`（默认 running） | — | 只有需要表达"进度"的集合才有 |
| `tags` | ✅ 默认 `[]` | ✅ 默认 `[]` | ✅ 默认 `[]` | 默认值让旧内容不写也不报错 |
| `featured` | ✅ 默认 false | — | — | 首页"精选项目"的筛选开关 |

### 5.2 两个关键设计点

**① 为什么是 `glob` loader**
Astro 7 的内容集合从"文件约定"改成"显式 loader"。`glob` 关心的是"哪一坨文件是内容"，`base` + `pattern` 两行就说清了。好处是不用把所有内容塞进同一个目录，也不用维护索引文件。

**② 文件 id 就是 URL slug**

```
src/content/projects/mybo.md          →  id = "mybo"          →  URL = /projects/mybo
src/content/notes/why-mybo.md         →  id = "why-mybo"      →  URL = /notes/why-mybo
src/content/experiments/first-ai-automation.md → id = "first-ai-automation"
```

文件名即路由。这就是"新增内容不改代码"能成立的根本原因——路由不是被写出来的，是被**推导**出来的。

**③ frontmatter 里不写 H1**
每篇 md 正文自带 `# 标题`，但页面 `<h1>` 已经由 frontmatter 的 `title` 渲染了。为避免重影，在 CSS 里隐藏正文首行 H1：

```css
.prose-mybo > h1:first-child { display: none; }
```

---

## 6. 路由层：8 个路由定义，零手写路由表

| 路由 | 文件 | 类型 | 数据来源 |
| --- | --- | --- | --- |
| `/` | `pages/index.astro` | 页面 | 三个集合（筛选+排序） |
| `/projects` | `pages/projects/index.astro` | 列表 | `projects` 全部，按日期倒序 |
| `/projects/mybo` | `pages/projects/[slug].astro` | 详情 | `getStaticPaths` 动态生成 |
| `/experiments` | `pages/experiments/index.astro` | 列表 | `experiments` 全部，按日期倒序 |
| `/experiments/first-ai-automation` | `pages/experiments/[slug].astro` | 详情 | 同上 |
| `/notes` | `pages/notes/index.astro` | 列表 | `notes` 全部，按日期倒序 |
| `/notes/why-mybo` | `pages/notes/[slug].astro` | 详情 | 同上 |
| `/about` | `pages/about.astro` | 页面 | 手写静态内容 |

> 表里的详情页写的是**示例 URL**：`[slug]` 这类动态路由只有一份文件，但每条内容都会生成一个 URL。所以"8 个路由定义"和"构建产物 HTML 数量"是两件事——产物数量 = 8 个固定页面 + 内容条目数。

### 6.1 详情页的生成方式

三个详情页用的是同一个套路——`getStaticPaths` 把集合里的每一条映射成一个页面：

```ts
export async function getStaticPaths() {
	const projects = await getCollection('projects');
	return projects.map((project) => ({
		params: { slug: project.id },
		props: { project },
	}));
}

const { project } = Astro.props;
const { Content } = await render(project);   // md 正文编译成可渲染组件
```

**新增一篇 `src/content/projects/xxx.md`，`/projects/xxx` 自动存在**，无需注册、无需重构。

### 6.2 首页的数据装配

首页不是静态展示，是**三种查询的组合**：

```ts
const featuredProjects = projects
	.filter((p) => p.data.featured)                              // 取精选
	.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
	.slice(0, 3);                                                // 最多 3 个

const latestExperiments = [...experiments]
	.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())
	.slice(0, 3);                                               // 取最新 3 条

const latestNotes = [...notes].sort(...).slice(0, 3);
```

注意 `[...experiments]` 先复制再排序——`getCollection` 返回的数组不应被原地改动，否则同一页面内多次排序会互相污染。

三处都做了数量截断（首页三个区块各 3 条）：首页只负责"**表明这里有什么**"，完整列表交给 `/projects`、`/experiments`、`/notes`。项目再多，首页也不会被撑长——`featured: true` 是入口开关，日期决定谁排前面，第 4 个之后的精选只在列表页出现。

首页当前包含 5 个区块：Hero（含架构示意图）→ Now Building → Featured Projects → Latest Experiments + Latest Notes → MyBo 运行系统。

---

## 7. 视图层：12 个组件的职责边界

拆组件的判断标准只有一条：**跨 ≥2 个页面复用，或者单文件超过 150 行**。宁可少拆，不要提前抽象。

| 组件 | 职责 | 被谁使用 |
| --- | --- | --- |
| `Layout.astro` | 全站外壳：head、字体、Nav、Footer、i18n 脚本 | 全部页面 |
| `Nav.astro` | 吸顶导航：品牌标 + 菜单 + 当前页高亮 + 语言开关 | Layout |
| `Footer.astro` | 版权 + 外链 | Layout |
| `PageHead.astro` | 页头：面包屑 + 眉标 + H1 + 导语 + 计数 | 全部列表页与详情页 |
| `SectionHeading.astro` | 区块标题：眉标 + H2 + "查看全部" | 首页各区块 |
| `ProjectCard.astro` | 项目卡（封面 + 状态 + 标题 + 摘要 + 标签） | 首页 + `/projects` |
| `ExperimentItem.astro` | 实验条目（序号 + 状态 + 日期 + 标题 + 摘要） | 首页 + `/experiments` |
| `NoteItem.astro` | 笔记条目（序号 + 日期 + 标题 + 摘要） | 首页 + `/notes` |
| `StatusBadge.astro` | 状态徽章：schema 的 status → 文案 + 配色 | 卡片、列表项、详情页 |
| `Tag.astro` | 标签胶囊（mono 小字，# 前缀） | 各卡片与列表项 |
| `LangToggle.astro` | 中/EN 分段开关 | Nav |
| `Welcome.astro` | ⚠ Astro 模板残留，**未被引用** | — |

**同一个组件服务首页和列表页**，这是刻意的：`ProjectCard` 同时被首页精选区和 `/projects` 使用，两处外观永远一致，改一次改到位。

`StatusBadge` 是唯一带"业务映射"的组件，它把 schema 的枚举翻译成展示层：

```ts
const statusKeyMap = { 'project:active': 'status.active', ... };
const toneMap = {
	'project:active':    'accent',  // 绿：进行中
	'project:completed': 'blue',    // 蓝：已完成
	'project:archived':  'mute',    // 灰：归档
	...
};
```

这样以后加一个状态，只改这张表，不用碰任何页面。

---

## 8. 视觉层：设计令牌 + 三个公共构件

### 8.1 设计令牌（`global.css` 的 `@theme`）

Tailwind v4 用 CSS 变量做配置，`@theme` 里声明的变量会自动生成对应工具类（`--color-mybo-fg` → `text-mybo-fg`）。

**色彩系统：单色 zinc 打底 + 仅两个语义色。**

| 令牌 | 值 | 用途 |
| --- | --- | --- |
| `--color-mybo-bg` | `#fafafa` | 页面底色 |
| `--color-mybo-surface` | `#ffffff` | 卡片 / 面板 |
| `--color-mybo-surface-2` | `#f4f4f5` | 次级填充 |
| `--color-mybo-line` | `#e6e6e8` | 分隔线 |
| `--color-mybo-line-strong` | `#d4d4d8` | 强调边框 |
| `--color-mybo-fg` | `#18181b` | 主文字 |
| `--color-mybo-fg-2` | `#3f3f46` | 次主文字 |
| `--color-mybo-muted` | `#52525b` | 正文（对比度 7.4:1） |
| `--color-mybo-faint` | `#71717a` | 小号标签（对比度 4.7:1，过 WCAG AA） |
| `--color-mybo-accent*` | `#047857 / #ecfdf5 / #a7f3d0` | 语义色 A：进行中 / 活跃 |
| `--color-mybo-blue*` | `#1d4ed8 / #eff6ff / #bfdbfe` | 语义色 B：已完成 / 流程 |
| `--radius-mybo[-md\|-sm]` | `16 / 12 / 8 px` | 圆角三档 |

**为什么只有两个语义色**：颜色越多，越容易退化成"彩虹标签墙"。把语义压缩到"进行中（绿）/ 已完成（蓝）"两种，剩下的信息交给字号、字重、mono 字体去表达。这是这套视觉能保持克制的原因。

**一个具体的对比度教训**：早期用 `#a1a1aa` 做小号灰字，白底上对比度约 2.6:1，远低于 AA 的 4.5:1。最终把"正文灰"定在 `#52525b`、"小号灰"定在 `#71717a`（4.7:1），**弃用 `#a1a1aa` 作为任何承载信息的文字颜色**。

### 8.2 三个公共构件

| 构件 | 作用 | 解决的问题 |
| --- | --- | --- |
| `.shell` | `max-width: 1120px` + `padding-inline: 1.5rem` + 居中 | 所有页面左右边界一致，栅格能对齐 |
| `.eyebrow` | mono / 11.5px / `letter-spacing: .16em` / 大写 | 全站眉标节奏统一 |
| `.prose-mybo` | Markdown 渲染正文的排版规则 | md 正文自动获得统一的标题、列表、代码块、引用、表格样式 |

`.prose-mybo` 覆盖了 h1–h4、`strong`、`a`、`ul/ol/li`、`code`、`pre`、`blockquote`、`hr`、`img`、`table`，并对 h1/h2 加了统一的装饰——标题前一根 20×2px 的短横线。**写 md 的人不需要写任何 class，样式由容器接管。**

### 8.3 字体策略

三层回退，且**非阻塞加载**：

```css
--font-sans: 'Inter', 'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei',
             system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
--font-mono: 'JetBrains Mono', 'Cascadia Mono', ui-monospace, Menlo, Consolas, monospace;
```

- 拉丁字符走 Inter / JetBrains Mono，中文走系统字体栈（不下载中文字体，省几百 KB）。
- 字体在 `Layout.astro` 的 `<head>` 里以 `media="print" onload="this.media='all'"` 的方式加载——**先当"不需要的样式表"跳过，加载完成后再启用**，避免 `@import` 或普通 `<link>` 阻塞首屏；`<noscript>` 里给一份同步版本兜底。
- 字体加载失败时自动落到系统字体，页面不会因为网络问题变成"无字天书"。

另外在 `@media (prefers-reduced-motion: reduce)` 下把动画与过渡压到 0.01ms，尊重系统的"减少动态效果"设置。

---

## 9. 中英文切换：本项目的核心工程问题

这是整个项目里唯一需要"设计"而不是"实现"的部分，也是踩坑最多的地方。

### 9.1 需求与约束

需求：**全站中英切换，默认中文。**

约束（来自项目已有的边界）：

1. **不能改 `content.config.ts`** —— 内容 schema 是稳定的
2. **不能改任何 md 文件** —— 中文内容是唯一事实来源
3. **不能产生重复路由** —— 一个文件只应该对应一个 URL
4. 无 JS 时页面仍应可读（SEO 与降级）

### 9.2 三个候选方案

| 方案 | 做法 | 优点 | 致命问题 |
| --- | --- | --- | --- |
| **A. 官方 i18n 路由** | 建 `src/content/projects/*.en.md`，路由变 `/en/projects/**` | 最干净，SEO 完美，两套语言各自独立 | 需要**改 schema 无关但会让集合条目翻倍** → 重复路由 / 列表页出现英文条目；且要维护双份 md |
| **B. 运行时整页替换** | 把英文文案打成一个 JSON，切换时重刷整页 | 实现简单 | 首屏必然闪、DOM 要重建、无 JS 时不可用 |
| **C. 属性驱动 + 客户端切换** ✅ | 元素同时带 `data-zh` / `data-en`，脚本按语言替换文本 | 零新路由、零 md 改动、无 JS 有中文兜底、切换零延迟 | DOM 中同时存在中英文；SEO 上有重复内容 |

**选 C。** 理由是它同时满足全部 4 条约束，代价（重复 DOM）在当前阶段可接受。方案 A 的代价是"内容要维护两份 + 路由结构变复杂"，那属于**内容层成本**，比 DOM 冗余贵得多。

### 9.3 实现四件套

**① `Layout.astro` 里两段内联脚本**

第一段放在 `<head>` **最前面**，只做一件事——在 CSS 生效前定下语言：

```html
<script is:inline>
	(function () {
		var lang = 'zh';
		try { if (localStorage.getItem('mybo-lang') === 'en') lang = 'en'; } catch (e) {}
		document.documentElement.setAttribute('data-lang', lang);
		document.documentElement.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
	})();
</script>
```

第二段放在 `</body>` 前，做真正的替换：

```js
var nodes = document.querySelectorAll('[data-zh][data-en]');
for (var i = 0; i < nodes.length; i++) {
	var el = nodes[i];
	var text = el.getAttribute(lang === 'en' ? 'data-en' : 'data-zh');
	if (text !== null) el.textContent = text;          // ← 注意：是 textContent
}

var panels = document.querySelectorAll('[data-panel]');
for (i = 0; i < panels.length; i++) {
	var parent = panels[i].parentNode;
	// 只在同一父容器里真的存在当前语言的面板时才切换，否则保留原面板
	var hasCurrent = !!(parent && parent.querySelector('[data-panel="' + lang + '"]'));
	panels[i].hidden = hasCurrent && panels[i].getAttribute('data-panel') !== lang;
}
document.documentElement.classList.add('lang-ready');
```

这里的 `hasCurrent` 判断不是防御性编程，是**必需**的：内容没补英文时详情页只有一个中文面板，如果无条件按语言显隐，切到英文就会把中文藏起来、又没有英文可显示，正文直接变空白。加上这一层之后，"没写英文"退化成"显示中文"，而不是"页面坏掉"。

`is:inline` 是关键：这两段是**同步**执行的，不经过 Astro 的打包与延迟加载，所以能跑在首帧之前。

**② 元素约定：`data-zh` 只能挂在纯文本叶子上**

因为脚本用的是 `textContent`，它会**抹掉元素内部的所有子标签**。所以：

```html
<!-- ❌ 错误：箭头 span 会被抹掉 -->
<a href="/projects" data-zh="浏览全部" data-en="View all">浏览全部 <span>→</span></a>

<!-- ✅ 正确：文案单独包一层，箭头留在外面 -->
<a href="/projects"><span data-zh="浏览全部" data-en="View all">浏览全部</span> <span>→</span></a>
```

这个约定被 `SectionHeading` 严格执行——它的"查看全部"链接就是把文案和箭头分成两个 span。

**③ 详情页正文：双面板整体显隐**

正文不是"替换文本"能解决的，所以用两个面板，靠 `data-panel` 整体切换：

```astro
<div class="prose-mybo max-w-[760px]" data-panel="zh"><Content /></div>

{en && (
	<div class="prose-mybo max-w-[760px]" lang="en"
	     data-panel="en" hidden set:html={en.html} />
)}
```

英文面板用 `set:html` 直接注入 HTML 片段，由 `.prose-mybo` 接管排版；`{en && ...}` 保证**没有英文的内容不会渲染空面板**。

**④ 文案与日期的分流**

| 内容类型 | 存放位置 | 取用方式 |
| --- | --- | --- |
| 界面固定文案（导航、按钮、状态名） | `src/i18n/ui.ts` | `t('nav.projects')` → `{ zh, en }` |
| 内容的英文（标题/描述/正文） | `src/i18n/content-en.ts` | 按集合 id 索引：`projectsEn[project.id]` |
| 日期与计数 | `src/utils/date.ts` | 组件收 `Date`，内部产出中英两套字符串 |

`utils/date.ts` 的设计值得单独说：**组件不接收"格式化好的字符串"，而是接收 `Date` 对象**，格式化在组件内部完成，一次输出两套：

```ts
export const formatDates = (date: Date): DateLabels => ({
	zh: date.toLocaleDateString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', timeZone:'UTC' }),
	en: date.toLocaleDateString('en-US', { year:'numeric', month:'short',   day:'numeric', timeZone:'UTC' }),
});
// → { zh: "2026/09/16", en: "Sep 16, 2026" }
```

注意 `timeZone: 'UTC'`——否则构建机时区一变，日期就可能差一天。

### 9.4 防闪烁：一个 CSS 规则 + 一个类名

属性驱动方案最难的不是替换，是**首帧**。默认渲染的是中文，如果用户偏好英文，就会闪一下中文。

解决方式是一个 CSS 规则 + 一个类名：

```css
/* 语言是 en，但脚本还没跑完 → 先把待翻译元素涂成透明 */
html[data-lang='en']:not(.lang-ready) [data-zh][data-en] {
	color: transparent !important;
}
html[data-lang='en']:not(.lang-ready) [data-panel='zh'] {
	display: none;
}
```

执行顺序保证了它成立：

```
head 脚本读到 en → 立刻写 data-lang="en"
   ↓  （CSS 命中规则，中文被涂透明，用户看不到错的语言）
body 末尾脚本替换全部 textContent、切换面板 → 加 .lang-ready
   ↓  （规则失效，文字显形）
```

整个过程发生在首帧之前，用户看到的第一眼就是正确语言。

### 9.5 踩过的坑

| 坑 | 现象 | 解法 |
| --- | --- | --- |
| `data-zh` 挂在含子元素的容器上 | 内部的 `<span>` / `<a>` 被 `textContent` 抹掉 | 只挂纯文本叶子节点，文案单独包 span |
| 隐私模式 / 禁用存储 | `localStorage` 抛异常，整个脚本挂掉 | 所有读写都包 `try/catch`，失败则退回中文 |
| Astro 对 `undefined` 属性的处理 | 传 `data-en={undefined}` | Astro 会**省略该属性**，元素自动保持中文，不报错——这正好成了"未翻译内容"的自然降级 |
| 面板显隐没考虑"没有英文" | 中文面板被脚本藏起来、英文面板又不存在 → 英文模式下详情页正文**空白**（新加的两个项目踩到） | 显隐前先判断同容器内是否存在当前语言的面板（`hasCurrent`），没有就保留原面板 |
| 中文界面下 mono 眉标过散 | `letter-spacing: .16em` 对 CJK 太宽 | `html[data-lang='zh'] .eyebrow { letter-spacing: 0.1em }` |
| `<title>` 也需要双语 | 标签页标题留着旧语言 | `<title>` 同样挂 `data-zh` / `data-en`，由同一段脚本处理 |

### 9.6 已知取舍（诚实记录）

**英文正文和中文正文同时存在于 DOM 中**（英文面板 `hidden`）。带来的后果：

- 搜索引擎可能把两种语言的正文视为重复内容；
- 页面 HTML 体积约为单语言的两倍（当前内容量级下 < 10KB，可忽略）。

**另一种取舍：内容没有英文时，英文模式下显示中文**（而不是隐藏或留白）。好处是新增内容零成本、永不空白；代价是英文模式下会混着中文。要让某条内容真正双语，只需在 `src/i18n/content-en.ts` 补一条——**不补也不会坏**。

**要彻底解决只有一条路**：改成方案 A 的 i18n 路由（`/en/**`），届时需要真正的英文 md 文件与 `content.config.ts` 变更。当前阶段判断：**不值得**，等内容量上来或英文流量形成规模再迁移。迁移时中文侧零改动，只是把 `content-en.ts` 的内容拆成 md 文件。

---

## 10. 响应式与移动端

按 `<640px`（Tailwind 的 `sm`）作为手机分界线。

### 10.1 导航：两行，而不是汉堡菜单

手机上导航变成两行：

```
┌──────────────────────────────┐
│ ⬤ MYBO              [中|EN]  │   ← 第一行：品牌标 + 字标 + 语言开关
│ 项目  实验室  笔记  关于      │   ← 第二行：菜单独占整行
└──────────────────────────────┘
```

实现方式是 `flex-wrap` + `order`，**没有写任何媒体查询，也没有引入汉堡菜单 JS**：

```html
<div class="shell flex flex-wrap items-center justify-between gap-x-4 py-2
            sm:h-16 sm:flex-nowrap sm:py-0">
	<a class="order-1 ..."><img src="/logo.png" class="h-5 w-auto sm:h-[22px]" alt="">MYBO</a>
	<LangToggle class="order-2 sm:order-3" />
	<div class="order-3 w-full min-w-0 sm:order-2 sm:w-auto sm:flex-1"> ... </div>
</div>
```

品牌标是 `public/logo.png`（蓝→橙渐变 MB monogram，透明底），源图 491×303 缩到 156×96 存放，导航里显示 20px（手机）/ 22px（桌面）——**保留约 4 倍余量**，高分屏不虚。它是一个纯位图标记，用 `<img>` 直接引用最省事：不需要内联 SVG、不参与打包、不进 JS。`alt=""` 是刻意的：右侧的字标已经把链接说清楚了，再给图标一个 alt 会让读屏念两遍。

**为什么不做汉堡菜单**：只有 4 个链接。为了藏起 4 个链接而引入开合状态、焦点管理、ARIA 属性、点击外部关闭等一整套逻辑，是负收益。两行导航在小屏上是一次"看得见全部出口"的简单交换。

### 10.2 字号与间距降档

统一用 `text-[小] sm:text-[桌面值]` 的写法：

| 元素 | 手机 | 桌面 |
| --- | --- | --- |
| Hero H1 | 32px | 50 / 56px |
| PageHead H1 | 27px | 44px |
| SectionHeading H2 | 21px | 28px |
| 区块纵向间距 | `py-14` / `py-16` | `py-20` / `py-24` |
| 卡片内边距 | `p-4` / `p-5` | `p-6` / `p-7` |

### 10.3 容易被忽略的三个细节

**① 安全区**

```css
@media (max-width: 480px) {
	.shell {
		padding-left:  max(1rem, env(safe-area-inset-left, 0px));
		padding-right: max(1rem, env(safe-area-inset-right, 0px));
	}
}
footer { padding-bottom: env(safe-area-inset-bottom, 0px); }
```

配合 `<meta name="viewport" content="... viewport-fit=cover">`，全面屏横屏时内容不会被刘海切掉、底部不会被手势条压住。

**② 触屏没有 hover**

```css
@media (hover: none) {
	.group:hover, a:hover { transform: none; }
}
```

iOS 上点击会触发并"粘住" hover 状态，卡片会一直保持浮起的样子。Tailwind v4 的 `hover:` 工具类自带 `(hover: hover)` 守卫，**手写的 hover 规则必须自己包**。

**③ 宽元素与锚点**

```css
[id] { scroll-margin-top: 6rem; }                                  /* 锚点跳到位置时避开吸顶导航 */
.prose-mybo { overflow-wrap: break-word; }                         /* 长 URL 不撑破容器 */
.prose-mybo table { display: block; width: 100%; overflow-x: auto; } /* 宽表格在小屏自己横向滚动 */
```

`scroll-margin-top: 6rem` 对应手机端两行吸顶导航约 62px 的高度——**如果以后调整导航内距，记得同步这个值。**

---

## 11. 构建与验证

### 11.1 命令

| 命令 | 作用 |
| --- | --- |
| `npm install` | 安装依赖 |
| `npm run dev` | 本地开发服务器（`localhost:4321`） |
| `npm run build` | 生产构建到 `dist/` |
| `npm run preview` | 本地预览构建产物 |

### 11.2 本次实测

```bash
> mybo@0.0.1 build
> astro build

[content] Syncing content
[content] Synced content
[types]   Generated 1.34s
[build]   output: "static"
[build]   mode: "static"

 generating static routes
 ├─ /about/index.html
 ├─ /experiments/first-ai-automation/index.html
 ├─ /experiments/index.html
 ├─ /notes/why-mybo/index.html
 ├─ /notes/index.html
 ├─ /projects/mybo/index.html
 ├─ /projects/mybo-搭建实现说明/index.html
 ├─ /projects/szccf-ai内容生产与发布自动化系统-项目案例-wb-20260922/index.html
 ├─ /projects/index.html
 └─ /index.html

[build] 10 page(s) built in 780ms
[build] Complete!
```

**产物特征**（这一点很能说明架构）：

```
dist/
├── index.html
├── about/index.html
├── projects/{index.html, <每个项目>/index.html}
├── experiments/{index.html, <每个实验>/index.html}
├── notes/{index.html, <每篇笔记>/index.html}
├── logo.png  favicon.ico  favicon.svg  apple-touch-icon.png   ← public/ 原样复制
└── _astro/ui.DIn1F4qx.css        ← 全部样式一个文件
```

- **N 个 HTML + 1 个 CSS，没有任何 JS chunk。** 因为全站脚本都是 `is:inline`，没有岛屿组件，Astro 不需要产出客户端 JS。（N = 8 个固定页面 + 内容条目数：写这份文档时是 8，加进 2 个项目后是 10——**产物数量随内容增长，这正是 Content Collections 的工作方式**。）
- 只在 `output: static` 下工作，不依赖任何服务器运行时——这正是能直接丢给 Cloudflare Pages 的原因。

### 11.3 每次改动后的验证清单

1. 浏览器页面是否正常
2. 详情页能否打开
3. 是否出现 404
4. 终端是否出现 error
5. `npm run build` 是否成功

推荐闭环：**改 → 浏览器验证 → `npm run build` → 确认无 error → Git commit**。

### 11.4 无头校验脚本

由于这台环境装不了浏览器自动化工具，改用了脚本化的无头校验（工作区 `.workbuddy/verify.cjs`，不属于项目仓库），检查项：

- 每个页面的 `data-en` 是否都有对应的 `data-zh`（允许反向多出：多出来的视为"待翻译"）
- 语言切换按钮是否存在（每页 2 个）
- 详情页正文面板：有英文的必须是双面板，没英文的必须只剩中文面板（走兜底，不能是空白）
- 导航是否存在品牌标 `src="/logo.png"`，且 `dist/logo.png` 已产出
- `Layout` 里的内联脚本能否通过语法检查
- `global.css` 关键规则（`lang-ready` 防闪烁、`scroll-margin-top`、`overflow-wrap` 等）是否存在
- 移动端断言：`viewport-fit`、导航两行、`safe-area`、`hover: none` 守卫

> **一个坑**：这个脚本是正则计数，而"搭建实现说明"这类文档正文里会成段引用 `data-zh` / `data-panel` / `data-set-lang` 的源码。所以计数前必须先把 `<script>` / `<pre>` / `<code>` 剥掉，否则会数出根本不存在的元素（曾被误报成"某页有 3 个语言按钮"）。

这不能替代肉眼验证，但能在重构时**兜住"结构被改坏"这类回归**。

---

## 12. 部署链路

```
Windows 11（本地开发）
    ↓  git push
GitHub  (github.com/bdhjh/mybo.git, 分支 master)
    ↓  自动触发
Cloudflare Pages  （构建命令 npm run build，产物目录 dist）
    ↓  自定义域
mybo.bot
```

仓库提交历史里有一条 `test: verify auto deployment`，即部署链路是**专门验证过的**，不是"提交完就不管了"。把部署放在视觉改造之前，就是为了让后续每次改动都能立刻看到一个线上可回退的版本。

**安全红线（必须持续遵守）**：绝不提交 API Key、Token、密码、Cloudflare Token、数据库密码、n8n 凭据、私有专家库数据、私人账号信息、私有业务数据。

`.gitignore` 已经覆盖了关键项：

```
node_modules/
dist/
.astro/
.env
.env.*
!.env.example      ← 只放行示例文件
```

**公网仓库与私有生产系统必须隔离**：MyBo 的网站仓库只承载展示内容，未来的 n8n / 数据库 / 私有服务走独立部署（见第 15 节）。

---

## 13. 关键决策汇总

一张表回看所有重要选择。**"何时应该改回去"这一列比决策本身更重要**——它防止某个决策被当成永久真理。

| 决策 | 选择 | 放弃了什么 | 什么情况下应该改回去 |
| --- | --- | --- | --- |
| 框架 | Astro 静态输出 | SSR / 框架组件 | 需要登录、评论、实时数据时 |
| 样式 | Tailwind + 设计令牌 | UI 组件库 | 需要复杂交互组件（表格、弹窗）时 |
| 内容 | Markdown + glob loader | MDX | 需要在正文里嵌入交互组件时（改后缀即可） |
| 内容与代码 | Content Collections | 硬编码进 `.astro` | 不适用——这是本项目的地基 |
| 导航 | Logo 即首页入口（4 项菜单） | 5 项菜单含 Home | 菜单超过 5 项时 |
| 导航品牌标 | `public/logo.png`（位图，20/22px） | 内联 SVG / 图标字体 | 拿到矢量源文件、或需要随主题换色时 |
| 导航命名 | 路由 `/experiments`，文案"实验室 / Lab" | 字面直译"实验" | 路由与文案要对齐 SEO 关键词时 |
| 移动端导航 | 两行 flex-wrap | 汉堡菜单 | 菜单项超过 5 个时 |
| 首页展示密度 | 精选项目**最多 3 个**（featured + 日期倒序截断） | 首页铺开全部精选 | 首页想承载更多时——更该做的是强化 `/projects` 列表页 |
| 中英切换 | 属性驱动 + 客户端脚本 | i18n 路由（方案 A） | 英文流量形成规模，或在意 SEO 重复内容时 |
| 项目卡封面 | 伪终端面板占位 | 真实截图 | 拿到项目截图后（需先给 schema 加 `cover` 字段） |
| 字体 | Inter + 系统中文栈，非阻塞加载 | 自托管中文字体 | 需要精确控制中文字形时（代价是几百 KB） |
| 语义色 | 只有 emerald / blue 两系 | 多彩标签体系 | 内容分类维度显著增加时 |

---

## 14. 已知遗留问题

诚实记录当前的状态，避免把"还没做"误当成"已经做好"。

| # | 问题 | 影响 | 建议动作 |
| --- | --- | --- | --- |
| 1 | **首页循环只写了 4 步**（`BUILD → LEARN → SHARE → ITERATE`），而项目定位里的核心循环是 6 步（`Explore → Build → Use → Learn → Share → Iterate`） | 首页与内容里的表述不一致 | 属**内容**问题不是技术问题，需先定稿再改 |
| 2 | schema 没有 `cover` 字段 | 项目卡永远走伪终端占位，无法展示真实截图 | `ProjectCard` 已预留 `cover` prop，只需给 schema 加字段并传入 |
| 3 | 模板残留未被引用：`components/Welcome.astro`、`assets/astro.svg`、`assets/background.svg`、`assets/images/hero/mybo-hero.webp`（**1.3 MB**） | 首张 hero 图占了仓库体积的大头 | 确认无引用后删除（未删是为避免误伤非授权范围） |
| 4 | `package.json` 里的 `@astrojs/markdown-satteri` 未被任何配置引用 | 多一个无用依赖 | 确认后移除 |
| 5 | `README.md` 仍是 Astro 官方模板内容 | 仓库首页对访问者没有信息量 | 替换为 MyBo 自己的项目说明 |
| 6 | 内容量仍偏少（projects 3 条、experiments / notes 各 1 条） | 列表页的视觉密度、分页/筛选需求都还没被真实数据检验 | 等内容超过 6～9 条再评估是否需要分页与筛选 |
| 7 | 全站脚本为内联，无法被浏览器缓存复用 | 多页浏览时重复下载脚本（当前体积很小，可忽略） | 脚本逻辑变复杂（>2KB）时考虑提取为外部资源 |
| 8 | `public/favicon.svg` 仍是 Astro 官方模板图标，而 `Layout` 的 `<head>` 里它声明在前且带 `type="image/svg+xml"` | 浏览器可能优先采用它 → 标签页仍显示旧图标（`favicon.ico` / `apple-touch-icon.png` 已换成 MyBo 的） | 换成 MyBo 的图标，或从 `<head>` 里移除这一行 |
| 9 | 部分内容没有英文（后加的两个项目未补 `content-en.ts`） | 英文模式下这些条目的标题与正文显示中文 | 需要双语时补 `content-en.ts` 对应条目；**不补不影响中文站** |

---

## 15. 后续路线：把阶段目标翻译成动作

| 阶段 | 目标 | 具体动作 |
| --- | --- | --- |
| **阶段 3 统一视觉**（接近完成） | 视觉一致性 | ✅ 设计令牌 + 组件化 + 响应式（两行导航、字号降档、安全区）+ 中英切换 + 导航品牌标已完成；首页三个区块各截断为 3 条。待办：统一各页 Section 节奏、补 `cover` 字段（需先动 schema） |
| **阶段 4 部署** | 上线 `mybo.bot` | 绑定自定义域、配置构建缓存、提交 sitemap 与 robots.txt |
| **阶段 5 项目展示强化** | 单个项目的表达力 | 加 `cover` 字段与截图、正文支持架构图（Mermaid 或图片）、加"背景/问题/方案/结果/复盘"的正文模板、加 GitHub 仓库外链字段 |
| **阶段 6 个人 AI 系统** | 从展示站变成系统入口 | 接入 n8n / Agent / MCP / RAG / 私有数据库；`lab.` / `tools.` / `research.` 子域分流；**公网站点只做展示，私有服务独立部署** |

**长期边界**：`mybo.bot` 公开层（Website / Projects / Experiments / Notes / About）与 `n8n.` / `experts.` 等私有层在架构上必须隔离。网站仓库里不出现任何凭据，私有服务走独立的部署与网络通道。

---

## 16. 维护手册：五种常见改动怎么做

### A. 新增一篇内容（最高频）

1. 在对应目录新建 md：`src/content/{projects|experiments|notes}/<文件名>.md`
2. 写 frontmatter（照抄同类文件，注意 `status` 的可选值与 `date` 格式）
   - **projects 专属**：`featured: true` 才会进首页「项目与系统」，且首页**最多显示 3 个**（按 `date` 倒序截断）——再多只会出现在 `/projects` 列表页
3. 正文从 `##` 级标题开始写（不要写 `#`，H1 由 frontmatter 提供）
4. **【可选】补英文**：在 `src/i18n/content-en.ts` 里按文件 id 加一条 `{ title, description, html }`
   - 不补 → 该内容在英文模式下保持中文显示（标题、描述、正文都是，不会报错、不会空白）
5. `npm run build` 确认无错，commit

> 文件名 = URL。改名会导致旧链接 404。

### B. 给内容加一个字段

1. `src/content.config.ts` 对应集合的 schema 加字段，**一定给默认值或 `.optional()`**，否则已有的 md 会全部报错
2. 在组件 / 页面里消费该字段
3. 逐篇给已有 md 补上该字段（或依赖默认值）
4. `npm run build` 验证

### C. 新增一种语言

1. `src/components/LangToggle.astro` 加一个按钮：`data-set-lang="<code>"`
2. `Layout.astro` 的 `readLang()` 里放开该值，`apply()` 里的 `lang` 属性映射加一条
3. `global.css` 的防闪烁规则扩展到新语言：`html[data-lang='<code>']:not(.lang-ready) [data-zh][data-en]`
4. 给元素补 `data-<code>` 属性（未补的元素自动保持中文）
5. `utils/date.ts` 的 `formatDates` 增加该语言分支

### D. 调整设计令牌

改 `global.css` 的 `@theme` 块即可，全站生效：

```css
@theme {
  --color-mybo-fg: #18181b;   /* 改这里 → 所有 text-mybo-fg 同步变 */
}
```

> 改颜色后请重新核对对比度（正文 ≥ 4.5:1）。

### E. 新增一个内容类型（例如 `blog`）

1. `content.config.ts` 新增集合定义
2. 建目录 `src/content/blog/`
3. 建路由 `src/pages/blog/index.astro` + `[slug].astro`（照抄 `notes` 的两份，改集合名）
4. 复用 `NoteItem` 或新建列表项组件
5. `src/i18n/ui.ts` 加导航文案，`Nav.astro` 加菜单项，`content-en.ts` 加英文层
6. 首页若要展示，在 `index.astro` 加一段查询

---

## 17. 这套架构的适用边界

**它适合**：以内容为主、交互为辅、需要长期演进的个人站点——作品集、实验室、知识库、文档站。

**它不适合**：需要登录态、实时数据、复杂表单与状态管理的应用。这类需求应该在**阶段 6** 由独立的子域应用承接，而不是把展示站改造成应用。

这条边界是刻意的。MyBo 的长期价值在于"真实项目驱动的个人 AI 系统"，网站只是它的**入口**——入口保持简单、稳定、零运维，才能把精力留给真正的项目。

---

*文档结束。配套阅读：《MyBo — 项目说明与运行指南》。*
