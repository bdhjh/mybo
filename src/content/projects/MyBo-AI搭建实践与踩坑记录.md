---
title: "MyBo AI 搭建实践与踩坑记录"
description: "记录 MyBo AI 从知识库整理、RAG 检索到 AI 对话助手上线的完整实现过程，以及 AI Search、Worker、CORS 和知识边界等实践与踩坑"
date: 2026-09-25
status: "completed"
tags: ["AI", "RAG", "Cloudflare", "Workers AI", "AI Search"]
featured: true
---

> 从一个静态个人网站开始，为 MyBo 增加一个真正能够理解项目内容、回答问题并引用项目资料的 AI 助手。

## 1. 为什么给 MyBo 加一个 AI 助手

MyBo 最初是一个个人 AI Lab / System Hub，用来记录自己的项目、实验、技术实践和思考。

随着内容越来越多，一个问题逐渐出现：

**如果别人想了解我做过什么，需要自己翻很多页面。**

例如：

* MyBo 是怎么搭建的？
* 我做过哪些 AI 自动化项目？
* SZCCF 的媒体内容生产流程是怎么实现的？
* MyBo 为什么选择 Astro？
* 我在 AI 自动化项目中使用了哪些工具？
* 某个问题以前有没有做过？

因此，我希望 MyBo 不只是一个展示内容的网站，而是增加一个能够“理解 MyBo 自己内容”的 AI 助手。

最终形成了：

> **Ask MyBo —— 一个基于 MyBo 自己知识库的 AI 问答助手。**

它不是简单接一个大模型聊天窗口，而是让 AI 在回答关于 MyBo 的问题时，优先基于真实项目资料。

---

## 2. 最终实现了什么

目前的 MyBo AI 由三个部分组成：

```text
                    MyBo
                      │
                Ask MyBo
                      │
                POST /api/chat
                      │
                      ▼
              ┌───────────────┐
              │  mybo-ai      │
              │ Cloudflare    │
              │ Worker        │
              └───────┬───────┘
                      │
             ┌────────┴────────┐
             ▼                 ▼
       Cloudflare AI       Workers AI
           Search             Model
             │                 │
             ▼                 ▼
        MyBo Knowledge      Llama 3.3
            Base
```

用户在 MyBo 页面打开 Ask MyBo 后：

1. 输入问题；
2. 前端发送 `/api/chat` 请求；
3. Worker 接收问题；
4. AI Search 从 MyBo 知识库中检索相关内容；
5. 将检索结果交给模型；
6. 模型根据知识库内容生成回答；
7. Worker 判断回答属于：

   * MyBo 已有记录；
   * 一般技术建议；
   * MyBo 没有相关记录；
8. 前端展示回答以及相关 MyBo 页面。

最终接口保持简单：

```json
{
  "message": "MyBo 是怎么搭建的？",
  "history": []
}
```

返回：

```json
{
  "answer": "...",
  "sources": [
    {
      "title": "...",
      "url": "/projects/..."
    }
  ]
}
```

---

## 3. 为什么没有一开始就上复杂架构

一开始其实可以选择很多方案：

* LangChain
* LangGraph
* Vectorize
* Supabase
* PostgreSQL + pgvector
* OpenAI API
* MCP
* Agent
* n8n
* 自建向量数据库

但 MyBo 当前真正需要解决的问题其实很简单：

> **让 AI 能够搜索我的 Markdown 知识库，然后基于这些内容回答问题。**

因此第一版采用了尽可能简单的架构：

```text
Astro
  ↓
Cloudflare Worker
  ↓
AI Search
  ↓
Workers AI
```

暂时不引入数据库、Agent、LangChain 等额外复杂度。

原因很简单：

**先把真正的问题解决，再增加复杂度。**

这也让每一层都比较容易替换。

例如：

```ts
interface KnowledgeSearch {
  search(
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult>;
}

interface ModelProvider {
  generate(
    input: ModelInput
  ): Promise<ModelOutput>;
}
```

未来如果更换搜索引擎或者模型，不需要重写整个系统。

---

## 4. 第一步：整理 MyBo 知识库

MyBo 原本的内容已经按照 Astro Content Collections 进行了组织：

```text
src/content/
├── projects/
├── experiments/
└── notes/
```

因此没有重新设计一套复杂的数据结构，而是直接把现有 Markdown 内容作为 AI 知识来源。

目前纳入知识库的主要内容包括：

```text
projects/
├── mybo.md
├── MyBo-搭建实现说明.md
└── SZCCF-AI内容生产与发布自动化系统-项目案例-WB-20260922.md

experiments/
└── first-ai-automation.md

notes/
└── why-mybo.md
```

同时增加：

```text
docs/
└── ai-knowledge-base.md
```

用于说明 AI 知识库的组织方式。

为了让后续搜索和管理更加明确，在 Markdown frontmatter 中增加了 `category` 等元数据。

例如：

```yaml
---
category: personal-lab
---
```

但没有为了 AI 而修改原有文章正文。

这点比较重要：

> **知识库应该尽量复用已有内容，而不是为了 AI 单独维护一份平行内容。**

---

## 5. 第一个比较大的坑：AI Search 的 R2 Connector

最开始考虑的是：

```text
Markdown
   ↓
R2
   ↓
Cloudflare AI Search
   ↓
Vector Search
```

因此创建了 R2 Bucket：

```text
mybo-ai-knowledge
```

并让 AI Search 从 R2 中读取数据。

但实际运行后发现：

**R2 Connector 的任务虽然显示完成，AI Search 中 Indexed 数量却一直是 0。**

也就是说：

```text
R2
 ↓
Connector Job
 ↓
Job completed
```

看起来没有报错，但：

```text
Indexed = 0
```

知识实际上没有正常进入可搜索状态。

这成为整个项目遇到的第一个比较关键的问题。

---

## 6. 最终解决办法：绕过 R2 Connector，直接调用 AI Search Items API

继续排查后发现，Cloudflare AI Search 提供了 Items API。

因此把知识同步方式从：

```text
R2 Connector
```

改成：

```text
本地 Markdown
     ↓
sync-ai-knowledge.ts
     ↓
Cloudflare AI Search Items API
     ↓
AI Search
```

同步脚本负责：

1. 扫描指定 Markdown；
2. 根据文件生成稳定的 item key；
3. 查询远端是否已经存在；
4. 已存在则删除旧版本；
5. 上传新的 Markdown；
6. 记录同步状态；
7. 下次运行时跳过没有变化的文件。

因此最终形成：

```bash
npm run sync:ai
```

第二次执行时：

```text
Uploaded: 0
Skipped: 5
Failed: 0
```

这说明同步机制已经能够识别没有变化的内容。

---

## 7. 为什么保留 R2

虽然最终没有继续依赖 R2 Connector 完成 AI Search 的索引，但 R2 并没有立即删除。

原因是：

> **现在没有必要为了“架构看起来更干净”而增加迁移风险。**

R2 可以暂时作为知识文件的存档/备份。

而 AI Search 的正式知识内容通过 Items API 管理。

这也是这次实践中的一个经验：

> **工程中不一定所有“暂时不用”的东西都要马上删除。**
>
> 如果它没有造成成本或安全问题，可以先保留，等架构稳定后再决定是否清理。

---

## 8. 第二个问题：Cloudflare API Token

调用 AI Search Items API 需要 Cloudflare API Token。

这个 Token 不能直接写进代码。

最终采用：

```text
Windows 环境变量
        ↓
CLOUDFLARE_API_TOKEN
        ↓
sync-ai-knowledge.ts
```

同时：

```text
.env
.env.*
.dev.vars
.dev.vars.*
.ai-knowledge/
```

都加入了 `.gitignore`。

这里有一个很重要的工程原则：

> **知识库可以公开，Token 不能公开。**

即使 GitHub 仓库是 Public，也不意味着所有项目配置都可以直接提交。

后来还专门对整个 Git 仓库进行了敏感信息检查，没有发现实际 Token、API Key 或私钥进入 Git。

---

## 9. Worker：把搜索和模型真正连接起来

接下来创建 Cloudflare Worker：

```text
workers/ai/
├── src/
│   ├── index.ts
│   ├── chat.ts
│   ├── search.ts
│   ├── model.ts
│   └── prompt.ts
├── package.json
├── tsconfig.json
├── wrangler.jsonc
└── README.md
```

职责进行了拆分：

```text
index.ts
   ↓
请求入口 / CORS / 路由

chat.ts
   ↓
对话流程

search.ts
   ↓
知识检索

model.ts
   ↓
模型调用

prompt.ts
   ↓
回答规则
```

这种拆分的目的不是为了“代码看起来专业”，而是为了以后可以单独替换其中一层。

---

## 10. 第一版模型

第一版使用 Cloudflare Workers AI：

```text
@cf/meta/llama-3.3-70b-instruct-fp8-fast
```

这样可以避免额外维护一个 OpenAI API Key。

模型层目前通过独立接口封装：

```text
ModelProvider
```

因此以后如果需要切换到其他模型，可以只替换模型实现，而不是修改整个聊天流程。

---

## 11. 第三个问题：AI Search 并不是“搜到就一定相关”

真正开始测试 RAG 后，发现了一个非常典型的问题：

**向量搜索有结果，不代表这些结果真的相关。**

例如询问：

> “火星殖民地怎么建设？”

AI Search 可能仍然返回一些 MyBo 内容。

原因是：

> 搜索系统认为“存在一定语义相似度”，但从人的角度看，这些内容完全没有回答问题。

如果简单写：

```text
搜索结果 > 0
    ↓
交给模型
```

就容易出现：

```text
用户问一个 MyBo 没有记录的问题
             ↓
搜索返回几个低相关结果
             ↓
模型看到这些内容
             ↓
模型开始“发挥”
             ↓
产生看起来合理、但并非 MyBo 实际经历的回答
```

这就是 RAG 系统非常容易踩的坑。

---

## 12. 尝试过“分数阈值”，但没有解决问题

一开始考虑：

> 如果搜索分数低于某个阈值，就认为没有找到。

于是进行了多轮测试。

但实际测试发现：

真正相关的问题，有些分数也并不高。

例如部分真实问题的分数只有：

```text
0.42
0.48
```

而明显无关的问题，有时却能得到：

```text
0.52
0.62
```

因此很难找到一个简单阈值：

```text
score > X = 相关
score < X = 不相关
```

因为：

> **搜索分数本身不能完全等价于“这个内容能不能回答用户的问题”。**

这个问题最终没有继续靠调整阈值硬解决。

---

## 13. V1.1：给 AI 增加“回答边界”

真正解决这个问题的方法，是让模型明确区分三种情况。

## FOUND

MyBo 知识库中存在可以支撑回答的内容。

这种情况下：

```text
知识库事实
    ↓
模型整理
    ↓
回答
    ↓
提供 MyBo 来源
```

---

## GENERAL

用户的问题属于一般技术咨询。

例如：

> “如果我要做一个类似 MyBo 的个人网站，应该怎么搭？”

这并不是：

> “MyBo 实际上是怎么做的？”

因此模型可以提供一般技术建议。

但必须明确：

> 这是一般技术建议，不代表 MyBo 实际采用过这种方案。

---

## NOT_FOUND

如果 MyBo 知识库中没有相关记录：

```text
NOT_FOUND
    ↓
不继续编造
    ↓
sources = []
```

例如：

> “MyBo 有没有做过电商系统？”

如果知识库没有记录，就直接说明：

> MyBo 知识库中暂时没有找到相关记录。

而不是拿几个无关页面出来充当“来源”。

---

## 14. 历史事实、当前判断和假设问题也必须分开

另一个测试问题是：

> “MyBo 为什么选择 Astro？如果现在重新开始，你还会这么选吗？”

知识库可以证明：

```text
过去为什么选择 Astro
```

但不能自动证明：

```text
现在重新做一次是否仍然选择 Astro
```

因为后者属于新的判断。

因此现在的规则是：

```text
历史事实
    ≠
当前决策
    ≠
假设性结论
```

如果知识库只记录了过去的选择，AI 就应该明确：

> 知识库能够确认当时为什么这样选择，但没有记录现在重新开始后的实际决策。

如果进一步给出分析，也要明确它属于：

> AI 的一般分析，而不是 MyBo 已经做出的实际决定。

这让 AI 不只是“少幻觉”，而是建立了一个更清晰的知识边界。

---

## 15. Ask MyBo 前端

前端增加了：

```text
src/components/ai/
├── AskMyBo.astro
├── ChatWindow.astro
└── ChatMessage.astro
```

页面右下角提供：

```text
Ask MyBo
```

点击后打开聊天窗口。

主要功能包括：

* 欢迎语
* 快捷问题
* Enter 发送
* Shift + Enter 换行
* 中文输入法兼容
* Loading 状态
* AI 回答
* 来源链接
* 移动端适配
* 请求超时处理

第一版前端其实是 Mock 数据。

这样做是有意的：

> **先把 UI 和交互验证好，再接真实 AI。**

否则前端、Worker、AI Search、模型同时出问题时，很难判断到底是哪一层出了问题。

---

## 16. 第四个问题：`API_ENDPOINT is not defined`

第一次把前端连接到真实 Worker 后，浏览器一直停留在：

```text
正在思考……
```

打开浏览器 Console 后发现：

```text
Uncaught ReferenceError:
API_ENDPOINT is not defined
```

检查代码后发现：

前面定义的是：

```ts
const AI_ENDPOINT = ...
```

但实际 inline script 中使用的是：

```ts
API_ENDPOINT
```

属于一个很普通、但实际很容易发生的变量名不一致问题。

更值得注意的是：

> Astro 的构建检查并没有直接发现这个错误。

因为这里涉及：

```astro
<script is:inline define:vars={...}>
```

脚本中的变量并不是普通 TypeScript 模块那样被完整检查。

最终统一为：

```ts
const API_ENDPOINT = import.meta.env.DEV
  ? 'https://mybo-ai-dev.jerrkhe.workers.dev/api/chat'
  : 'https://mybo-ai.jerrkhe.workers.dev/api/chat';
```

之后浏览器真实请求恢复正常。

---

## 17. 第五个问题：本地开发环境 CORS

接下来又遇到了另一个问题。

本地开发：

```text
http://localhost:4321
```

生产网站：

```text
https://mybo.bot
```

如果 Worker 只允许：

```text
https://mybo.bot
https://www.mybo.bot
```

那么本地浏览器请求就会被 CORS 拦截。

但如果简单把：

```text
Access-Control-Allow-Origin: *
```

打开，又会削弱生产环境的限制。

因此最终采用：

```text
开发环境
localhost
      ↓
mybo-ai-dev

生产环境
mybo.bot
      ↓
mybo-ai
```

也就是：

```text
                  Ask MyBo
                     │
             ┌───────┴───────┐
             │               │
           DEV             PROD
             │               │
             ▼               ▼
      mybo-ai-dev       mybo-ai
             │               │
        localhost        mybo.bot
```

开发 Worker：

```text
https://mybo-ai-dev.jerrkhe.workers.dev
```

生产 Worker：

```text
https://mybo-ai.jerrkhe.workers.dev
```

这样既方便本地调试，又不会为了开发环境放宽生产 CORS。

---

## 18. 为什么没有直接把 Worker 挂到 `ai.mybo.bot`

目前 Worker 使用：

```text
*.workers.dev
```

域名。

并没有急着配置：

```text
ai.mybo.bot
```

原因很简单：

**当前功能已经可以正常运行。**

自定义域名属于体验和架构优化，而不是当前功能闭环的必要条件。

因此暂时保持：

```text
mybo.bot
   ↓
Ask MyBo
   ↓
mybo-ai.jerrkhe.workers.dev
```

以后需要时再增加自定义域名即可。

---

## 19. 第六个问题：Cloudflare AI Search 偶发 500

在测试过程中还观察到过：

```text
7073 All search methods failed: vector
```

也就是说，AI Search 偶尔会出现上游搜索失败。

这类问题和自己的代码逻辑并不完全相同。

目前没有立即增加复杂的重试、Fallback、缓存体系。

原因是：

> 当前系统规模很小，先观察真实使用情况，再决定是否值得增加基础设施。

如果后续出现稳定复现，可以考虑：

```text
AI Search
   ↓
失败
   ↓
Retry
   ↓
仍失败
   ↓
友好的错误提示
```

但暂时不为了极低概率的问题增加大量代码。

---

## 20. 当前性能

实际测试中，完整回答通常大约需要：

```text
6～12 秒
```

主要时间来自：

```text
用户问题
 ↓
AI Search
 ↓
模型推理
 ↓
Worker
 ↓
浏览器
```

目前这个速度可以接受。

因为 MyBo 当前是：

> **个人项目 / 项目展示 / AI 实践作品**

而不是高并发商业客服系统。

因此当前阶段没有急着做：

* Streaming
* 更换模型
* 多级缓存
* 更复杂的检索策略
* Agent
* 多模型路由

先保证：

```text
回答正确
>
来源真实
>
边界清晰
>
架构简单
```

---

## 21. Git 仓库也踩了一次坑

AI 功能完成后，对 Git 工作区进行了完整检查。

发现：

```text
workers/ai/.wrangler/
```

里面存在 Cloudflare Wrangler 本地运行产生的文件，包括：

* 本地 SQLite
* observability 数据
* 临时 bundle
* sourcemap
* WAL 文件

这些文件并不是项目源代码。

而且体积也明显大于普通源码。

因此增加：

```text
.wrangler/
```

同时增加：

```text
.workbuddy/

*.log
logs/
log/

.cache/
.tmp/
tmp/
temp/

.idea/
*.swp
```

这样可以避免未来误把本地运行数据、WorkBuddy 工作区、日志和缓存提交到 Git。

---

## 22. Git 安全检查

在提交前还进行了敏感信息检查。

重点检查：

```text
CLOUDFLARE_API_TOKEN
OPENAI_API_KEY
oauth_token
sk-
BEGIN PRIVATE KEY
```

确认没有实际 Token、API Key 或私钥进入 Git 工作区。

最终需要进入 Git 的主要内容是：

```text
docs/
scripts/
src/components/ai/
workers/ai/
```

以及对应的网站和配置修改。

而：

```text
.env
.dev.vars
.wrangler/
.ai-knowledge/
```

等本地或敏感内容不会进入仓库。

---

## 23. 当前项目结构

现在 MyBo 大致形成了这样的结构：

```text
mybo/
├── src/
│   ├── components/
│   │   └── ai/
│   │       ├── AskMyBo.astro
│   │       ├── ChatWindow.astro
│   │       └── ChatMessage.astro
│   │
│   ├── content/
│   │   ├── projects/
│   │   ├── experiments/
│   │   └── notes/
│   │
│   ├── layouts/
│   └── pages/
│
├── workers/
│   └── ai/
│       ├── src/
│       │   ├── index.ts
│       │   ├── chat.ts
│       │   ├── search.ts
│       │   ├── model.ts
│       │   └── prompt.ts
│       ├── package.json
│       ├── tsconfig.json
│       └── wrangler.jsonc
│
├── scripts/
│   └── sync-ai-knowledge.ts
│
├── docs/
│   └── ai-knowledge-base.md
│
├── astro.config.mjs
├── package.json
└── .gitignore
```

---

## 24. 最终技术栈

| 层                | 技术                   |
| ---------------- | -------------------- |
| Website          | Astro                |
| UI               | Tailwind CSS         |
| Content          | Markdown / MDX       |
| Frontend AI UI   | Astro Components     |
| API              | Cloudflare Workers   |
| Knowledge Search | Cloudflare AI Search |
| Embedding        | Qwen3 Embedding 0.6B |
| Model            | Llama 3.3 70B        |
| Knowledge Sync   | Node.js + TypeScript |
| Deployment       | Cloudflare           |
| Source Control   | GitHub               |

---

## 25. 目前没有使用的技术

为了控制复杂度，V1 没有使用：

```text
LangChain
LangGraph
Vectorize
Supabase
PostgreSQL
pgvector
n8n
MCP
Agent
自建向量数据库
```

这并不意味着这些技术不好。

只是当前 MyBo 的问题还没有复杂到需要它们。

---

## 26. 目前 MyBo AI 能做什么

目前比较适合的问题包括：

### 项目事实

例如：

> MyBo 使用了哪些技术？

> 我做过哪些 AI 自动化项目？

> SZCCF 的媒体内容生产流程是什么？

这类问题应该优先基于知识库回答，并提供 MyBo 页面来源。

### 项目背景

例如：

> MyBo 为什么选择 Astro？

这类问题可以根据项目记录解释历史背景。

### 一般技术咨询

例如：

> 如果我要做一个类似 MyBo 的个人网站，应该怎么搭？

这时 AI 可以提供一般技术方案，但需要明确：

> 这是一般技术建议，不代表 MyBo 实际采用过该方案。

### 知识库不存在的问题

例如：

> MyBo 有没有做过电商系统？

如果没有记录，就应该明确告诉用户：

> MyBo 知识库中暂时没有找到相关记录。

而不是编造。

---

## 27. 当前仍然存在的限制

目前系统已经形成完整闭环，但仍然不是一个“最终版本”。

主要限制包括：

### 1. 知识库规模较小

目前只有少量 MyBo 项目资料。

随着项目增加，检索质量才有更大的实际验证价值。

### 2. 搜索质量仍然依赖 AI Search

向量搜索偶尔可能返回语义上“看起来相关”但实际无关的内容。

目前通过：

```text
FOUND
GENERAL
NOT_FOUND
```

以及 Prompt 边界进行控制。

### 3. 偶发 AI Search 失败

目前观察到过：

```text
All search methods failed: vector
```

后续可以增加重试和错误降级。

### 4. 尚未使用 Streaming

目前需要等待模型生成完成后再显示完整回答。

后续如果希望提高交互体验，可以增加流式输出。

### 5. Worker 仍使用 workers.dev 域名

未来可以考虑：

```text
ai.mybo.bot
```

作为正式 API 地址。

---

## 28. 下一步可能怎么发展

如果继续迭代，我会优先考虑以下方向。

## 第一阶段：提高稳定性

```text
AI Search
    ↓
Retry
    ↓
Fallback
    ↓
友好错误提示
```

解决偶发搜索失败。

## 第二阶段：改善回答体验

增加：

```text
Streaming
```

让回答逐字出现。

## 第三阶段：扩大知识库

随着 MyBo 内容增加：

```text
项目
实验
文章
技术笔记
踩坑记录
```

全部进入统一知识体系。

## 第四阶段：增加更智能的检索

如果简单向量搜索无法满足需求，再考虑：

```text
Hybrid Search
Reranking
Query Rewrite
```

而不是一开始就把这些全部加入。

## 第五阶段：再考虑 Agent

只有当 MyBo AI 不只是“回答问题”，而需要：

```text
搜索多个来源
分析项目
执行操作
调用工具
生成内容
```

时，再考虑 Agent / MCP 等更复杂的架构。

---

## 29. 这次实践最大的收获

这次 MyBo AI 项目表面上是在做一个：

> RAG + Chatbot

但真正让我意识到的问题其实不是：

> “怎么把大模型接进网站？”

而是：

> **怎样让 AI 知道什么是真的，什么只是建议，什么是不知道。**

这三个边界非常重要：

```text
                 AI 回答
                    │
       ┌────────────┼────────────┐
       │            │            │
       ▼            ▼            ▼
   MyBo事实      一般建议       不知道
   FOUND         GENERAL       NOT_FOUND
       │            │            │
   有真实来源    明确标注        不编造
```

如果只是：

```text
用户问题
 ↓
搜索
 ↓
大模型
 ↓
回答
```

系统很容易看起来“很聪明”。

但真正可靠的 AI 系统，需要知道：

> **什么时候应该回答，什么时候应该说这是一般建议，什么时候应该明确说“我不知道”。**

---

## 30. 项目最终状态

目前 MyBo AI 已经完成从 0 到 1 的完整闭环：

```text
MyBo Markdown
      ↓
知识库整理
      ↓
AI Search
      ↓
Cloudflare Worker
      ↓
Workers AI
      ↓
回答边界控制
      ↓
Ask MyBo
      ↓
真实网站运行
```

同时完成了：

* 知识库建立
* AI Search 接入
* AI Search Items API 同步
* Worker API
* Workers AI
* 前端聊天 UI
* 开发/生产环境分离
* CORS 控制
* 来源链接
* FOUND / GENERAL / NOT_FOUND 边界
* Git 安全检查
* 本地 Wrangler 文件隔离
* GitHub + Cloudflare 自动部署

这不是一个为了展示而搭出来的 Demo。

它更像是一次完整的小型 AI 系统工程实践：

> **从已有内容出发，解决真实问题，在遇到问题后逐层排查，并最终形成一个能够真正运行的 AI 功能。**

而 MyBo 本身也因此从：

```text
一个记录项目的网站
```

进一步变成：

```text
项目展示
    +
知识库
    +
AI 问答入口
    +
个人 AI 实验场
```

这也是 MyBo 后续继续扩展的基础。
