# mybo-ai —— MyBo AI Assistant 后端

一个独立的 Cloudflare Worker，与 Astro 站点完全解耦，部署为 `ai.mybo.bot`。

```text
mybo.bot（Astro 静态站）
        │  POST https://ai.mybo.bot/api/chat
        ▼
   workers/ai（本目录）
        │
        ├─ Search Layer   search.ts   Cloudflare AI Search（数据源：R2）
        └─ Model Layer    model.ts    Workers AI（可替换）
        │
        ▼
   { answer, sources }
```

## 文件职责

| 文件 | 职责 | 不允许出现 |
| --- | --- | --- |
| `src/index.ts` | HTTP 边界：路由、校验、CORS、错误映射、依赖装配 | 业务流程 |
| `src/chat.ts` | 业务流程：检索 → 组装上下文 → 调模型 → 整理来源 | 任何具体 API |
| `src/search.ts` | 检索抽象 + Cloudflare AI Search 实现 | 模型、HTTP |
| `src/model.ts` | 模型抽象 + Workers AI / OpenAI 兼容实现 | 检索、HTTP |
| `src/prompt.ts` | System Prompt 与上下文组装 | 一切 API 细节 |

**换模型**：在 `model.ts` 里加一个满足 `ModelProvider` 的工厂，`index.ts` 的 `createModelProvider()` 加一个分支。
`chat.ts` / `search.ts` / 路由一行都不用改。

**换检索**：在 `search.ts` 里加一个满足 `KnowledgeSearch` 的工厂，改 `index.ts` 的装配处。同上。

## 首次部署（需要你亲自执行的部分）

> 下面标 🔑 的步骤需要 Cloudflare 登录，是交互式 OAuth，无法由脚本代做。

### 1. 安装依赖 + 登录

```bash
cd workers/ai
npm install
npx wrangler login          # 🔑 浏览器里点 Allow
```

### 2. 创建 R2 bucket

```bash
npx wrangler r2 bucket create mybo-ai-knowledge
```

### 3. 创建 AI Search 实例（数据源指向这个 bucket）

```bash
npx wrangler ai-search create mybo-knowledge --type r2 --source mybo-ai-knowledge
```

创建后**必须**在控制台（AI → AI Search → mybo-knowledge → Data source）配置 **Path filtering**：

| 规则 | 值 | 原因 |
| --- | --- | --- |
| Include | `/kb/**` | 只把知识文档当知识 |
| Exclude | — | — |

`manifest.json` 放在 bucket 根目录、不在 `kb/` 下，因此不会被索引成知识，
但仍然能被 Worker 通过 R2 绑定读到（用来把对象键映射成标题 + 站内 URL）。

> 如果首次创建时没配 path filtering，`manifest.json` 会被当成一篇知识文档检索进来。
> 发现回答里出现 manifest 内容时，检查这条配置。

### 4. 同步知识库

```bash
cd ../..                    # 回到仓库根目录
npm run sync:ai             # 生成 + 上传
npm run sync:ai -- --dry-run   # 只生成，不上传（先看产物）
```

### 5. 部署

```bash
cd workers/ai
npx wrangler deploy         # 🔑
```

### 6. 自定义域 `ai.mybo.bot`（已启用）

`wrangler.jsonc` 里已配置：

```jsonc
"routes": [{ "pattern": "ai.mybo.bot", "custom_domain": true }]
```

Cloudflare 会自动创建 DNS 记录并签发证书，不需要手动改 DNS。
`workers.dev` 子域同时保留（`workers_dev: true`），只是生产前端不再使用它——
`*.workers.dev` 在国内部分网络环境下不可达（手机端无法访问），自定义域就是为了绕开它。

⚠ **不要**用 `wrangler.jsonc` 部署开发 Worker，否则它会去抢 `ai.mybo.bot`。开发走下面那份独立配置。

## 本地开发

### 先说结论：本机目前跑不起 Worker

`npx wrangler dev` 需要建立远程 binding 会话（AI Search / Workers AI 无法在本地模拟），
当前账号调用该接口会失败：

```text
A request to the Cloudflare API (.../workers/subdomain/edge-preview) failed.
You do not have access to this feature. [code: 10023]
```

所以 `astro dev`（`http://localhost:4321`）没法连本机 Worker，只能连一个已部署的 Worker。

### 做法：另署一个开发用 Worker

同一份代码，独立的配置文件 `wrangler.dev.jsonc`：名字 `mybo-ai-dev`、
白名单换成 localhost、**不带任何自定义域**（避免与生产抢 `ai.mybo.bot`）——
**生产 Worker `mybo-ai` 的配置与白名单完全不受影响**：

```bash
cd workers/ai
npx wrangler deploy -c wrangler.dev.jsonc      # 🔑
```

前端 `src/components/ai/AskMyBo.astro` 在渲染期决定后端地址：

| 场景 | 后端 |
| --- | --- |
| `astro dev`（`import.meta.env.DEV`） | `https://mybo-ai-dev.jerrkhe.workers.dev/api/chat` |
| `astro build`（生产） | `https://ai.mybo.bot/api/chat` |

localhost 只出现在 dev Worker 的白名单里，**不写进 `wrangler.jsonc`、不进生产配置**。

> ⚠️ `wrangler.dev.jsonc` 必须保留 `workers_dev: true`：dev Worker 只能通过
> `*.workers.dev` 访问，一旦被关掉，localhost 联调直接失效。

> ⚠️ `wrangler deploy` 走 OAuth 身份。如果环境里设了 `CLOUDFLARE_API_TOKEN`，它会优先被使用，
> 可能报 `No access to the specified resource`；此时先 `unset CLOUDFLARE_API_TOKEN` 再部署。

### 备用：`.dev.vars`

`workers/ai/.dev.vars` 已写好同样的 localhost 白名单（**已被 .gitignore 忽略**）。
等远程 binding 会话可用时，直接 `npx wrangler dev` 就能让 localhost 调通，
前端改回指向本机端口即可。

CORS 只回白名单里的精确来源，**不使用 `*`**、不反射任意 Origin。

## API

### `POST /api/chat`

请求：

```json
{ "message": "你做过哪些 AI 自动化项目？", "history": [] }
```

响应 `200`：

```json
{
  "answer": "……",
  "sources": [{ "title": "AI 内容生产与发布自动化系统", "url": "/projects/…", "category": "ai-automation" }]
}
```

错误响应（同样带 CORS 头，不含任何内部细节，详细原因只进 Worker 日志）：

```json
{ "error": { "code": "AI_UNAVAILABLE", "message": "AI 服务暂时无法响应，请稍后再试。" } }
```

> 前端会把失败分成两类展示：请求没到后端（DNS 不可达 / fetch reject / 超时 / 断网）
> 显示「网络请求失败，请检查网络连接后重试。」；后端回了但拿不到回答则显示
> 「AI 服务暂时无法响应，请稍后再试。」

| code | 状态 | 含义 |
| --- | --- | --- |
| `INVALID_REQUEST` | 400 / 405 | 空消息、非字符串、超长（默认 500 字）、非法 JSON、错误方法 |
| `AI_UNAVAILABLE` | 502 | 检索或模型调用失败 |

## 安全约定

- V1 用 Workers AI，**不需要任何 Secret**。不要为了"先占个位"去创建无意义的 Secret。
- 将来接 OpenAI 兼容接口时：`npx wrangler secret put OPENAI_API_KEY`，并设置 `MODEL_PROVIDER=openai`。
- 密钥绝不写进代码、`wrangler.jsonc`、Markdown 或被 Git 跟踪的 `.env`。`.dev.vars` 与 `.dev.vars.*` 已在 `.gitignore` 中忽略。
- 来源里只给站内 URL，R2 对象键（`kb/...`）是内部信息，不进 Prompt、不进响应。
