/**
 * Worker 入口：路由、校验、CORS、错误映射、依赖装配。
 *
 * 业务流程在 chat.ts，检索在 search.ts，模型在 model.ts。
 * 这里只做"HTTP 边界"上的事。
 */

import { runChat } from './chat';
import type { ChatTurn } from './model';
import { createWorkersAIProvider, createOpenAICompatibleProvider } from './model';
import type { ModelProvider } from './model';
import {
	createCloudflareAISearch,
	type KnowledgeManifest,
} from './search';

// ---------------------------------------------------------------------------
// 环境
// ---------------------------------------------------------------------------

interface AISearchInstanceLike {
	search(input: {
		messages: Array<{ role: string; content: string }>;
	}): Promise<unknown>;
}

export interface Env {
	/** Workers AI binding（wrangler.jsonc: "ai"） */
	AI: {
		run(model: string, input: Record<string, unknown>): Promise<unknown>;
	};
	/** Cloudflare AI Search 实例绑定（wrangler.jsonc: "ai_search"） */
	KNOWLEDGE_SEARCH: AISearchInstanceLike;
	/** 知识库 bucket，用来读 manifest.json（wrangler.jsonc: "r2_buckets"） */
	KNOWLEDGE_BUCKET: { get(key: string): Promise<{ json(): Promise<unknown> } | null> };

	ALLOWED_ORIGINS?: string;
	WORKERS_AI_MODEL?: string;
	MODEL_PROVIDER?: string;
	OPENAI_API_KEY?: string;
	OPENAI_BASE_URL?: string;
	OPENAI_MODEL?: string;
	MAX_TOP_K?: string;
	MAX_INPUT_CHARS?: string;
}

const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DEFAULT_MAX_INPUT = 500;
const MANIFEST_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

type ErrorCode = 'INVALID_REQUEST' | 'AI_UNAVAILABLE';

const ERROR_MESSAGE: Record<ErrorCode, string> = {
	INVALID_REQUEST: '请求格式不正确。',
	AI_UNAVAILABLE: 'AI 服务暂时无法响应，请稍后再试。',
};

/**
 * 错误响应也必须带 CORS 头：否则浏览器侧只会看到一次 fetch reject，
 * Network 里看不到真实状态码与 body，线上问题无从排查。
 * 白名单逻辑与成功响应完全共用 corsHeaders()，不会放宽。
 */
function errorResponse(code: ErrorCode, status: number, origin: string | null, env: Env): Response {
	return Response.json(
		{ error: { code, message: ERROR_MESSAGE[code] } },
		{ status, headers: corsHeaders(origin, env) }
	);
}

// ---------------------------------------------------------------------------
// CORS：只允许白名单来源，绝不返回 "*"
// ---------------------------------------------------------------------------

function allowedOrigins(env: Env): string[] {
	return (env.ALLOWED_ORIGINS ?? 'https://mybo.bot,https://www.mybo.bot')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function baseHeaders(): Record<string, string> {
	return { vary: 'Origin', 'cache-control': 'no-store' };
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
	const headers = baseHeaders();
	if (origin && allowedOrigins(env).includes(origin)) {
		headers['access-control-allow-origin'] = origin;
		headers['access-control-allow-methods'] = 'POST, OPTIONS';
		headers['access-control-allow-headers'] = 'content-type';
		headers['access-control-max-age'] = '86400';
	}
	return headers;
}

// ---------------------------------------------------------------------------
// manifest 缓存（对象键 → 标题 / 站内 URL）
// ---------------------------------------------------------------------------

let manifestCache: { data: KnowledgeManifest; at: number } | null = null;

async function loadManifest(env: Env) {
	if (manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL_MS) {
		return manifestCache.data;
	}
	try {
		const obj = await env.KNOWLEDGE_BUCKET.get('manifest.json');
		if (!obj) return null;
		const data = (await obj.json()) as KnowledgeManifest;
		manifestCache = { data, at: Date.now() };
		return data;
	} catch (e) {
		// manifest 读不到不致命：search.ts 会用对象键兜底推导 URL
		console.error('[manifest] load failed:', e instanceof Error ? e.message : e);
		return null;
	}
}

// ---------------------------------------------------------------------------
// 依赖装配
// ---------------------------------------------------------------------------

function createModelProvider(env: Env): ModelProvider {
	if (env.MODEL_PROVIDER === 'openai' && env.OPENAI_API_KEY) {
		return createOpenAICompatibleProvider({
			apiKey: env.OPENAI_API_KEY,
			model: env.OPENAI_MODEL ?? 'gpt-4o-mini',
			...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}),
		});
	}

	return createWorkersAIProvider({
		ai: env.AI,
		model: env.WORKERS_AI_MODEL ?? DEFAULT_MODEL,
	});
}

// ---------------------------------------------------------------------------
// 请求处理
// ---------------------------------------------------------------------------

interface ChatRequestBody {
	message?: unknown;
	history?: unknown;
}

async function handleChat(request: Request, env: Env): Promise<Response> {
	const origin = request.headers.get('origin');

	let body: ChatRequestBody;
	try {
		body = (await request.json()) as ChatRequestBody;
	} catch {
		return errorResponse('INVALID_REQUEST', 400, origin, env);
	}

	if (typeof body.message !== 'string' || body.message.trim().length === 0) {
		return errorResponse('INVALID_REQUEST', 400, origin, env);
	}

	const maxChars = Number(env.MAX_INPUT_CHARS) || DEFAULT_MAX_INPUT;
	if (body.message.length > maxChars) {
		return errorResponse('INVALID_REQUEST', 400, origin, env);
	}

	const history = Array.isArray(body.history) ? (body.history as ChatTurn[]) : [];

	try {
		const result = await runChat(
			{ message: body.message, history },
			{
				search: createCloudflareAISearch({
					instance: env.KNOWLEDGE_SEARCH as never,
					loadManifest: () => loadManifest(env),
				}),
				model: createModelProvider(env),
				topK: Number(env.MAX_TOP_K) || 5,
			}
		);

		return Response.json(result, {
			status: 200,
			headers: corsHeaders(request.headers.get('origin'), env),
		});
	} catch (e) {
		// 详细原因只进日志，不进响应
		console.error('[chat] failed:', e instanceof Error ? e.message : e);
		return errorResponse('AI_UNAVAILABLE', 502, origin, env);
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const origin = request.headers.get('origin');

		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: corsHeaders(origin, env),
			});
		}

		if (url.pathname === '/api/chat') {
			if (request.method !== 'POST') {
				return errorResponse('INVALID_REQUEST', 405, origin, env);
			}
			return handleChat(request, env);
		}

		// 健康检查 / 占位首页，方便 wrangler dev 与部署后自检
		return Response.json(
			{ service: 'mybo-ai', ok: true },
			{ status: 200, headers: corsHeaders(origin, env) }
		);
	},
};
