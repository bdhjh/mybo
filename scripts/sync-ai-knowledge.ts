/**
 * MyBo AI 知识库同步脚本
 *
 *   npm run sync:ai                 生成知识文档并上传到 AI Search（built-in storage）
 *   npm run sync:ai -- --dry-run    只生成，不上传（不写 sync state、不发任何网络请求）
 *   npm run sync:ai -- --force      忽略已有 hash，全量重新上传/更新
 *
 * 链路：
 *   src/content/**  →  知识文档（含 metadata 注释头）  →  AI Search Items REST API
 *   →  instance 的 built-in storage（自动向量化 / 语义检索）
 *
 * 认证：只从环境变量 CLOUDFLARE_API_TOKEN 读取。
 *   Windows PowerShell: $env:CLOUDFLARE_API_TOKEN='...'; npm run sync:ai
 *   Git Bash:           CLOUDFLARE_API_TOKEN='...' npm run sync:ai
 * Token 绝不写进代码 / 配置文件 / Git，也不会出现在任何输出里（输出前统一脱敏）。
 *
 * 增量判据：本地 sync state（key → sha256）。该文件只在「上传成功」后写入，
 * dry-run 与上传失败都不会留下记录，避免把不存在的知识文档当成已同步。
 *
 * 职责边界：
 *   - 只读 src/content/**，绝不修改源 Markdown（源 md 是唯一真源）
 *   - 产物写到 .ai-knowledge/（已被 .gitignore 覆盖）
 *   - 失败必须可见，不静默
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// ─── 路径与常量 ───────────────────────────────────────────────────────────

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const CONTENT_DIR = join(ROOT, 'src', 'content');
const OUT_DIR = join(ROOT, '.ai-knowledge');
const STATE_FILE = join(OUT_DIR, '.sync-state.json');

const COLLECTIONS = ['projects', 'experiments', 'notes'] as const;
type Collection = (typeof COLLECTIONS)[number];

// ─── AI Search 目标（可用环境变量覆盖） ───────────────────────────────────

const DEFAULT_ACCOUNT_ID = '489d5939b65910f0666c9c5c62bab6b9';
const DEFAULT_INSTANCE = 'mybo-knowledge';
const DEFAULT_NAMESPACE = 'default';

const envArg = (name: string, fallback: string): string => {
	const raw = process.env[name];
	return raw && raw.trim() ? raw.trim() : fallback;
};

const ACCOUNT_ID = envArg('CLOUDFLARE_ACCOUNT_ID', DEFAULT_ACCOUNT_ID);
const INSTANCE = envArg('AI_SEARCH_INSTANCE', DEFAULT_INSTANCE);
const NAMESPACE = envArg('AI_SEARCH_NAMESPACE', DEFAULT_NAMESPACE);
/** 唯一的敏感输入。只在上传时读取，dry-run 时可以为 undefined。 */
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN?.trim();

const API_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai-search/namespaces/${NAMESPACE}/instances/${INSTANCE}`;
const ITEMS_ENDPOINT = `${API_BASE}/items`;

// ─── 参数 ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
/** --force：忽略已有 hash，全量重新上传/更新（用于状态文件不可信或怀疑远端缺文件） */
const force = argv.includes('--force');

// ─── 极简 frontmatter 解析（不引第三方依赖） ───────────────────────────────

type Frontmatter = Record<string, string | string[] | boolean>;

function stripQuotes(v: string): string {
	const t = v.trim();
	if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
		return t.slice(1, -1);
	}
	return t;
}

function parseScalar(v: string): string | boolean {
	const t = stripQuotes(v);
	if (t === 'true') return true;
	if (t === 'false') return false;
	return t;
}

function parseFrontmatter(raw: string): { data: Frontmatter; body: string } {
	const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
	if (!match) return { data: {}, body: raw };

	const data: Frontmatter = {};
	let currentKey: string | null = null;

	for (const line of match[1].split(/\r?\n/)) {
		if (!line.trim()) continue;

		const item = /^\s*-\s+(.+)$/.exec(line);
		if (item && currentKey) {
			const prev = data[currentKey];
			const arr = Array.isArray(prev) ? prev : [];
			arr.push(stripQuotes(item[1]));
			data[currentKey] = arr;
			continue;
		}

		const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
		if (!kv) continue;

		const key = kv[1];
		const value = kv[2].trim();
		currentKey = key;

		if (value === '') {
			data[key] = [];
			continue;
		}

		const inline = /^\[(.*)\]$/.exec(value);
		if (inline) {
			data[key] = inline[1]
				.split(',')
				.map((s) => stripQuotes(s))
				.filter(Boolean);
			continue;
		}

		data[key] = parseScalar(value);
	}

	return { data, body: raw.slice(match[0].length) };
}

const asString = (v: unknown): string | undefined =>
	typeof v === 'string' && v ? v : undefined;
const asArray = (v: unknown): string[] => (Array.isArray(v) ? v : []);

// ─── 敏感信息扫描 ─────────────────────────────────────────────────────────
// 只匹配"看起来像真实凭据的值"，不匹配"API Key"这类词本身
// （搭建实现说明的安全红线章节里就有这些词，按词匹配必然误报）。

const SECRET_PATTERNS: Array<{ name: string; re: RegExp }> = [
	{ name: 'OpenAI/Anthropic 风格密钥', re: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/ },
	{ name: 'Bearer token', re: /Bearer\s+[A-Za-z0-9._-]{16,}/ },
	{
		name: '被赋值的密钥/口令',
		re: /(?:api[_-]?key|apikey|secret|token|password|passwd|access[_-]?key)\s*["']?\s*[:=]\s*["']?[A-Za-z0-9._\-]{8,}/i,
	},
	{ name: 'AWS Access Key ID', re: /\bAKIA[0-9A-Z]{16}\b/ },
	{ name: '私钥块', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
	{ name: 'Cloudflare API Token（40 位十六进制）', re: /\b[A-Fa-f0-9]{40}\b/ },
];

function scanSecrets(text: string): string[] {
	const hits: string[] = [];
	const lines = text.split(/\r?\n/);
	lines.forEach((line, i) => {
		for (const p of SECRET_PATTERNS) {
			if (p.re.test(line)) hits.push(`第 ${i + 1} 行命中「${p.name}」`);
		}
	});
	return hits;
}

// ─── 生成知识文档 ─────────────────────────────────────────────────────────

interface KnowledgeEntry {
	id: string;
	type: Collection;
	title: string;
	description: string;
	url: string;
	category?: string;
	tools?: string[];
	status?: string;
	date?: string;
}

interface BuiltDoc {
	entry: KnowledgeEntry;
	key: string;
	content: string;
	hash: string;
}

function buildDoc(collection: Collection, fileName: string, raw: string): BuiltDoc {
	const { data, body } = parseFrontmatter(raw);

	// Astro glob loader 会把 id 转小写（中文保留）→ URL 必须按同一规则推导
	const id = basename(fileName, '.md').toLowerCase();
	const url = `/${collection}/${id}`;

	const title = asString(data.title) ?? id;
	const description = asString(data.description) ?? '';
	const cleanedBody = body.replace(/^﻿?\s*#\s+.*\r?\n?/, '').trim();

	const entry: KnowledgeEntry = {
		id,
		type: collection,
		title,
		description,
		url,
		...(asString(data.category) ? { category: asString(data.category) } : {}),
		...(asArray(data.tools).length ? { tools: asArray(data.tools) } : {}),
		...(asString(data.status) ? { status: asString(data.status) } : {}),
		...(asString(data.date) ? { date: asString(data.date) } : {}),
	};

	const metaLines = [
		`id: ${id}`,
		`type: ${collection}`,
		`url: ${url}`,
		...(entry.category ? [`category: ${entry.category}`] : []),
		...(entry.tools?.length ? [`tools: ${entry.tools.join(', ')}`] : []),
		...(entry.status ? [`status: ${entry.status}`] : []),
		...(entry.date ? [`date: ${entry.date}`] : []),
		...(asArray(data.tags).length ? [`tags: ${asArray(data.tags).join(', ')}`] : []),
	];

	const content = [
		'<!-- mybo-kb',
		...metaLines,
		'-->',
		'',
		`# ${title}`,
		'',
		description,
		'',
		cleanedBody,
		'',
	].join('\n');

	// AI Search Item key：`集合/内容 id.md`，例如 projects/mybo.md、notes/why-mybo.md。
	// 前缀直接用集合名即可 —— 已不再走 R2，无需 kb/ 前缀（那个前缀只为 R2 path filtering 服务）。
	const key = `${collection}/${id}.md`;

	return { entry, key, content, hash: createHash('sha256').update(content).digest('hex') };
}

// ─── 上传：AI Search Items REST API ───────────────────────────────────────
//
// 官方 API（Cloudflare AI Search · Items REST API，2026-09 版）：
//   上传   POST   /accounts/{account_id}/ai-search/namespaces/{ns}/instances/{id}/items
//           multipart/form-data，字段名 file；key 取自该 part 的 filename（≤128 字符）
//   查询   GET    …/items?key=<key>&source=builtin      按 key + source 精确定位
//   删除   DELETE …/items/{item_id}
//
// 响应形如 { success, result: {...}, errors: [...], messages: [...] }；
// 只有 success === true 且 HTTP 2xx 才算成功。

interface UploadOutcome {
	ok: boolean;
	/** 人类可读的失败原因。**绝不包含 Token**。 */
	detail: string;
}

interface ApiEnvelope {
	success?: boolean;
	errors?: Array<{ code?: number | string; message?: string }>;
	messages?: Array<{ code?: number | string; message?: string }>;
	result?: unknown;
}

/** 任何输出在打印前都要过一遍这里，防止 Token 意外出现在日志里 */
function redact(text: string): string {
	if (!API_TOKEN || API_TOKEN.length < 8) return text;
	return text.split(API_TOKEN).join('***REDACTED***');
}

function summarizeErrors(status: number, rawBody: string): string {
	let envelope: ApiEnvelope | null = null;
	try {
		envelope = JSON.parse(rawBody) as ApiEnvelope;
	} catch {
		envelope = null;
	}

	const parts: string[] = [`HTTP ${status}`];
	if (envelope?.errors?.length) {
		for (const e of envelope.errors) {
			parts.push(`ERRORS ${e.code ?? '-'} ${e.message ?? ''}`.trim());
		}
	}
	if (envelope?.messages?.length) {
		for (const m of envelope.messages) {
			parts.push(`MESSAGES ${m.code ?? '-'} ${m.message ?? ''}`.trim());
		}
	}
	if (parts.length === 1) {
		parts.push(redact(rawBody).slice(0, 300) || '(空响应体)');
	}
	return redact(parts.join(' | '));
}

async function apiGetItemId(key: string): Promise<{ ok: boolean; itemId?: string; detail: string }> {
	const url = `${ITEMS_ENDPOINT}?key=${encodeURIComponent(key)}&source=builtin`;
	const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${API_TOKEN}` } });
	const body = await res.text();
	if (!res.ok || !isSuccess(body)) {
		return { ok: false, detail: summarizeErrors(res.status, body) };
	}
	const item = firstItem(body);
	return { ok: true, itemId: item?.id, detail: '' };
}

async function apiDeleteItem(itemId: string): Promise<UploadOutcome> {
	const res = await fetch(`${ITEMS_ENDPOINT}/${encodeURIComponent(itemId)}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${API_TOKEN}` },
	});
	const body = await res.text();
	if (!res.ok || !isSuccess(body)) {
		return { ok: false, detail: summarizeErrors(res.status, body) };
	}
	return { ok: true, detail: '' };
}

function isSuccess(body: string): boolean {
	try {
		return (JSON.parse(body) as ApiEnvelope).success === true;
	} catch {
		return false;
	}
}

function firstItem(body: string): { id?: string } | undefined {
	try {
		const list = (JSON.parse(body) as { result?: Array<{ id?: string }> }).result;
		return Array.isArray(list) ? list[0] : undefined;
	} catch {
		return undefined;
	}
}

/**
 * 上传（同 key 视为更新）。
 *
 * 官方只说明了「key 在同一 source 内唯一」，并未明确说明重复上传同一 key 是覆盖、
 * 报错还是去重，因此这里不猜服务端行为：先用 GET ?key=…&source=builtin 定位旧
 * item，存在则 DELETE，再 POST。这样无论服务端是否 upsert，都不会产生重复的知识
 * 文档，且同一个 Markdown 反复同步始终只有一份。
 */
async function uploadItem(key: string, content: string): Promise<UploadOutcome> {
	if (!API_TOKEN) {
		return { ok: false, detail: '缺少环境变量 CLOUDFLARE_API_TOKEN' };
	}

	const existing = await apiGetItemId(key);
	if (!existing.ok) {
		return { ok: false, detail: `查询已存在 item 失败：${existing.detail}` };
	}
	if (existing.itemId) {
		const deleted = await apiDeleteItem(existing.itemId);
		if (!deleted.ok) {
			return { ok: false, detail: `删除旧版本失败：${deleted.detail}` };
		}
	}

	const form = new FormData();
	form.append(
		'file',
		new File([content], key, { type: 'text/markdown' }),
	);

	const res = await fetch(ITEMS_ENDPOINT, {
		method: 'POST',
		headers: { Authorization: `Bearer ${API_TOKEN}` },
		body: form,
	});
	const body = await res.text();
	if (!res.ok || !isSuccess(body)) {
		return { ok: false, detail: summarizeErrors(res.status, body) };
	}
	return { ok: true, detail: '' };
}

// ─── 主流程 ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	console.log('AI Knowledge Sync');
	console.log(
		`Target:       AI Search built-in storage  ${NAMESPACE}/${INSTANCE}${
			dryRun ? '  (dry-run)' : ''
		}${force ? '  (force)' : ''}`,
	);
	console.log('');

	// dry-run 允许没有 Token（它不发任何网络请求）
	if (!dryRun && !API_TOKEN) {
		console.error('缺少环境变量 CLOUDFLARE_API_TOKEN，已中止（未上传任何内容）。');
		console.error('  PowerShell: $env:CLOUDFLARE_API_TOKEN=\'...\'; npm run sync:ai');
		console.error('  Git Bash  : CLOUDFLARE_API_TOKEN=\'...\' npm run sync:ai');
		process.exitCode = 1;
		return;
	}

	const counts: Record<Collection, number> = { projects: 0, experiments: 0, notes: 0 };
	const docs: BuiltDoc[] = [];
	const problems: Array<{ file: string; reason: string }> = [];

	// 1. 读取并生成
	for (const collection of COLLECTIONS) {
		const dir = join(CONTENT_DIR, collection);
		if (!existsSync(dir)) continue;

		const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
		counts[collection] = files.length;

		for (const fileName of files) {
			const rel = `src/content/${collection}/${fileName}`;
			const raw = readFileSync(join(dir, fileName), 'utf8');

			const hits = scanSecrets(raw);
			if (hits.length > 0) {
				problems.push({ file: rel, reason: `疑似包含敏感信息：${hits.join('；')}` });
				continue;
			}

			try {
				docs.push(buildDoc(collection, fileName, raw));
			} catch (e) {
				problems.push({
					file: rel,
					reason: `解析失败：${e instanceof Error ? e.message : String(e)}`,
				});
			}
		}
	}

	// 2. 写出产物
	mkdirSync(OUT_DIR, { recursive: true });
	const previous: Record<string, string> = existsSync(STATE_FILE)
		? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Record<string, string>)
		: {};

	const nextState: Record<string, string> = {};
	let uploaded = 0;
	let skipped = 0;
	let failed = 0;

	for (const doc of docs) {
		const outFile = join(OUT_DIR, doc.key.replace(/\//g, '__'));
		writeFileSync(outFile, doc.content, 'utf8');

		// dry-run：只生成产物，不上传，也不记进 sync state
		if (dryRun) {
			skipped += 1;
			continue;
		}

		if (!force && previous[doc.key] === doc.hash) {
			skipped += 1;
			nextState[doc.key] = doc.hash;
			continue;
		}

		const result = await uploadItem(doc.key, doc.content);
		if (result.ok) {
			uploaded += 1;
			// ⚠ hash 只在 AI Search 上传成功之后才写入 sync state。
			// 若失败也写入，下次运行会命中「内容未变化」而跳过，
			// 结果是远端永久缺文档且 Skipped 看起来一切正常。
			nextState[doc.key] = doc.hash;
		} else {
			failed += 1;
			problems.push({ file: doc.key, reason: `上传失败：${result.detail}` });
		}
	}

	// 3. manifest：仅作为本地参考产物（便于核对 key ↔ 站内 URL 的映射），
	//    不再上传到任何远端 —— 它不是知识文档，不能被 AI Search 索引。
	const manifest = {
		generatedAt: new Date().toISOString(),
		entries: docs.map((d) => d.entry),
	};
	writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

	// dry-run 绝不落盘 sync state —— 否则会把「生成过」误记成「上传过」
	if (!dryRun) {
		writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2), 'utf8');
	}

	// 4. 汇总
	console.log(`Projects:     ${counts.projects}`);
	console.log(`Experiments:  ${counts.experiments}`);
	console.log(`Notes:        ${counts.notes}`);
	console.log('');
	console.log(`Uploaded:     ${uploaded}`);
	console.log(`Skipped:      ${skipped}${dryRun ? '  (dry-run)' : '  (内容未变化)'}`);
	console.log(`Failed:       ${failed}`);

	if (problems.length > 0) {
		console.log('');
		for (const p of problems) {
			console.log(`file:\n${p.file}`);
			console.log(`reason:\n${p.reason}`);
			console.log('');
		}
		process.exitCode = 1;
	}
}

try {
	await main();
} catch (e) {
	console.error(`同步脚本异常终止：${e instanceof Error ? redact(e.message) : redact(String(e))}`);
	process.exitCode = 1;
}
