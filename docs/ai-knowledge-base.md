# MyBo AI 知识库规范（V1）

> 本文定义 MyBo AI Assistant 的**知识来源、字段语义、派生规则与更新流程**。
> 只讲"知识库是什么、怎么来的"，不讲 Worker / 模型 / 前端实现（那些在各自的阶段文档里）。

---

## 1. 唯一真源

AI 的知识**只有一个来源**：

```text
src/content/projects/*.md
src/content/experiments/*.md
src/content/notes/*.md
```

**不维护第二套知识库。** 知识库里的一切都是这三个目录的**派生产物**（由脚本生成），改内容永远只改 md。

`docs/`、`README.md`、以及本文件**不进知识库**。

---

## 2. 字段表

### 2.1 现有字段（网站在用，`content.config.ts` 已定义）

| 字段 | 含义 | AI 用途 |
| --- | --- | --- |
| `title` | 标题 | 来源卡片标题 |
| `description` | 摘要 | 检索加权信号 |
| `date` | 日期 | 时效性提示、排序 |
| `status` | `active/completed/archived`（projects）<br>`idea/running/completed`（experiments） | 回答"还在做吗" |
| `tags` | 标签 | 检索加权信号 |
| `featured` | 首页精选 | 不重要，但保留 |

### 2.2 新增字段（仅 AI 用，网站不消费）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `category` | string | 主题分类，见 §2.3 |
| `tools` | string[] | 该条内容**实际用到**的工具 / 平台 / 服务 |

> **为什么这两个字段不写进 `content.config.ts`**：
> schema 用的是 `z.object()`，默认行为是**剥离未知键**——多写的字段不会报错，也不会渲染到页面上，
> 但原始 md 里是真实存在的，同步脚本能直接读到。
> 这样做到"给 AI 补元数据"而**不动 schema、不改页面、不加路由**，代价为零。

### 2.3 `category` 取值

| 值 | 含义 | 当前条目 |
| --- | --- | --- |
| `personal-lab` | MyBo 自身定位、理念、缘起 | `projects/mybo.md`、`notes/why-mybo.md` |
| `website-engineering` | MyBo **网站本身**的技术与工程记录 | `projects/MyBo-搭建实现说明.md` |
| `ai-automation` | 真实的 AI 自动化项目 / 实验 | `projects/SZCCF-...md`、`experiments/first-ai-automation.md` |

**`website-engineering` 是一条重要的语义边界**：它是"MyBo 网站怎么搭的"，不是"MyBo 对外做过的项目"。
AI 在回答"MyBo 网站用什么技术"时引用它；回答"MyBo 做过哪些项目"时**不应把它当成客户项目推荐**。
这条边界写进 System Prompt（STEP 2）。

### 2.4 `tools` 的作用

用户会问"WorkBuddy 在你的项目里负责什么""n8n 做过哪些事情"——这类**按工具检索**的问题，
`tags` 表达不了（`tags` 会出现在网站卡片上，塞工具名会污染视觉），所以单列 `tools`。

`tools` 只填**正文里真实出现过**的工具，不填泛泛相关词。

---

## 3. 派生规则（不写进 md 的字段）

| 派生字段 | 规则 |
| --- | --- |
| `type` | 由目录决定：`projects` / `experiments` / `notes`。**不写进 frontmatter**——目录已经是事实，写两遍必然不同步 |
| `url` | `/{type}/{id}`，其中 `id` = **文件名去掉扩展名并转小写** |
| `id` | 同上 |

### ⚠ URL 的大小写坑（实测）

Astro 的 `glob` loader 会把文件 id **转小写**，但**保留中文**。实测构建产物：

| 文件 | 实际 URL |
| --- | --- |
| `mybo.md` | `/projects/mybo` |
| `MyBo-搭建实现说明.md` | `/projects/mybo-搭建实现说明` |
| `SZCCF-AI内容生产与发布自动化系统-项目案例-WB-20260922.md` | `/projects/szccf-ai内容生产与发布自动化系统-项目案例-wb-20260922` |

注意 `SZCCF` → `szccf`、`WB` → `wb`。**同步脚本必须按"转小写"推导 URL，直接拼文件名会 404。**
另外 Cloudflare Pages 的路径**区分大小写**，本地与线上必须一致。

---

## 4. 知识文档格式（同步脚本产物）

同步脚本把每篇 md 转成一个知识文档，对象键：

```text
{type}/{id}.md          例：projects/mybo-搭建实现说明.md
```

文档内容 = 元信息头 + 正文（正文一字不改，只去掉与 `title` 重复的首个 `# H1`）：

```markdown
<!-- mybo-kb
id: mybo-搭建实现说明
type: projects
url: /projects/mybo-搭建实现说明
category: website-engineering
tools: Astro, Tailwind CSS, TypeScript, Node.js, Cloudflare Pages, GitHub
status: completed
date: 2026-09-19
tags: AI, Agent
-->

# MyBo 搭建实现说明

记录 MyBo 从技术选型到部署的完整实现过程

## 0. 先给结论
……
```

同时生成一份 `manifest.json`（同样是派生产物），供 Worker 把检索结果映射成可点击来源：

```json
{
  "generatedAt": "2026-09-23T…",
  "entries": [
    {
      "id": "mybo-搭建实现说明",
      "type": "projects",
      "title": "MyBo 搭建实现说明",
      "description": "记录 MyBo 从技术选型到部署的完整实现过程",
      "url": "/projects/mybo-搭建实现说明",
      "category": "website-engineering",
      "tools": ["Astro", "Tailwind CSS"],
      "status": "completed",
      "date": "2026-09-19"
    }
  ]
}
```

**为什么要 manifest**：检索返回的是文本片段 + 对象键，键里没有中文标题。
Worker 用键查 manifest 才能给来源卡片填上可读标题和真实链接，而不是显示 `chunk_123`。

---

## 5. 更新流程

```text
改 md（唯一真源）
   ↓
npm run sync:ai        ← 本地跑，生成知识文档 + manifest
   ↓
上传到知识库存储        ← 覆盖同名对象
   ↓
检索层自动重新索引
```

- **网站构建（Cloudflare Pages）与知识库同步是两条独立链路。** 网站不需要知道 AI 的存在。
- 新增/改名/删除 md → 必须重跑一次同步，否则 AI 的知识会过期。
- 改名会同时改变 URL 和对象键 → **旧链接 404、旧对象变孤儿**。改名要当作一次迁移处理。

---

## 6. 安全边界

知识库会把 md **全文送进检索层与模型**。因此：

- md 里**不得出现** API Key、Token、密码、账号、私有业务数据、私有专家库内容。
- 已公开到 mybo.bot 的内容才允许进知识库；私有内容一律不进。
- 同步脚本在生成时做一次**敏感词扫描**（Key / Token / Secret / Password / Bearer / `sk-` 等），命中即中止并报警，不静默上传。
- 所有凭据只放 Cloudflare Worker Secrets / 本地 `.env`（已被 `.gitignore` 覆盖）。

---

## 7. V1 当前知识清单

| # | id | type | category | 体量 | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1 | `mybo` | projects | personal-lab | 很小 | MyBo 定位与核心循环 |
| 2 | `mybo-搭建实现说明` | projects | website-engineering | 大（约 43 KB） | 网站自身工程文档，**不是对外项目** |
| 3 | `szccf-ai内容生产与发布自动化系统-项目案例-wb-20260922` | projects | ai-automation | 大（约 28 KB） | 内容最丰富的真实项目，含问题/解决/成果 |
| 4 | `first-ai-automation` | experiments | ai-automation | 很小 | 占位性质，正文只有目标清单，**无实质结论** |
| 5 | `why-mybo` | notes | personal-lab | 小 | 缘起 |

**已知质量问题（不修，交给 Prompt 处理）**：

- `first-ai-automation` 正文是"计划写什么"，没有结论。被检索到时容易产生空洞回答 →
  Prompt 要求：引用实验类内容时必须带上"该实验目前仍在记录中，尚无结论"。
- `mybo-搭建实现说明` 含大量源码与构建日志，可能被切出无意义的碎片 →
  同步时保留原结构，由检索层打分过滤；必要时对该文件单独设置更小的分片。

---

## 8. V1 未做的事（留到后续阶段）

- 不做图片/截图检索（`public/images/**` 目前为空）。
- 不做英文知识库。英文正文在 `src/i18n/content-en.ts`，是 TS 不是 md，
  V1 先只索引中文；英文问答靠模型翻译中文知识来回答。
- 不做增量同步（V1 每次全量覆盖，内容量小，成本可忽略）。
