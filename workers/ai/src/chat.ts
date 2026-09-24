/**
 * Chat Service —— 只负责业务流程。
 *
 * 这个文件里不允许出现：
 *   - Cloudflare AI Search 的 API 细节（在 search.ts）
 *   - Workers AI / OpenAI 的 API 细节（在 model.ts）
 *   - HTML / Astro / DOM（在前端组件）
 *
 * 它只做：检索 → 组装上下文 → 调模型 → 整理来源。
 */

import type { KnowledgeSearch, SearchResult } from './search';
import type { ChatTurn, ModelProvider } from './model';
import { SYSTEM_PROMPT, buildKnowledgeContext, buildUserPrompt } from './prompt';

export interface ChatRequest {
	message: string;
	history?: ChatTurn[];
}

/** 给前端的来源结构：只有公开信息，不含任何内部路径 */
export interface ChatSource {
	title: string;
	url: string;
	category?: string;
}

export interface ChatResponse {
	answer: string;
	sources: ChatSource[];
}

export interface ChatDeps {
	search: KnowledgeSearch;
	model: ModelProvider;
	topK?: number;
}

/** 检索无结果时的固定回复（不调模型，从根上杜绝编造） */
export const NO_KNOWLEDGE_MESSAGE =
	'MyBo 知识库中暂时没有找到相关记录。你可以换个问法，或者去 /projects、/experiments、/notes 看看已有的内容。';

/** 纯一般技术建议的兜底声明：模型漏标时由这里补上，确保不会看起来像 MyBo 的实践 */
export const GENERAL_ADVICE_NOTICE =
	'\n\n（以上属于一般技术建议，不代表 MyBo 已经实际采用或验证过。）';

const MAX_HISTORY_TURNS = 6;
const MAX_HISTORY_CHARS = 400;
const MAX_SOURCES = 3;

/** 只保留 user/assistant 轮次，并做长度与条数限制 */
function sanitizeHistory(history: unknown): ChatTurn[] {
	if (!Array.isArray(history)) return [];

	return history
		.filter(
			(t): t is ChatTurn =>
				!!t &&
				typeof (t as ChatTurn).content === 'string' &&
				((t as ChatTurn).role === 'user' || (t as ChatTurn).role === 'assistant')
		)
		.slice(-MAX_HISTORY_TURNS)
		.map((t) => ({
			role: t.role,
			content: t.content.slice(0, MAX_HISTORY_CHARS),
		}));
}

/** 来源去重（同一文档可能命中多个分片），按相关性排序后截断 */
function toSources(results: SearchResult[]): ChatSource[] {
	const seen = new Map<string, ChatSource>();

	for (const r of results) {
		const url = r.source.url;
		if (!url || seen.has(url)) continue;
		seen.set(url, {
			title: r.source.title,
			url,
			...(r.source.category ? { category: r.source.category } : {}),
		});
		if (seen.size >= MAX_SOURCES) break;
	}

	return [...seen.values()];
}

/**
 * 模型回答的状态行（见 prompt.ts 的「输出协议」）。
 *
 * 为什么需要它：AI Search 对「火星殖民地」这类问题也会返回低相关分片，
 * 单纯靠 score 阈值无法区分（实测相关与不相关的分数区间完全交叠）。
 * 所以让模型自己判定「这些材料能不能支撑问题」，我们只解析第一行做兜底。
 */
type AnswerStatus = 'FOUND' | 'GENERAL' | 'NOT_FOUND';

/**
 * 只认单独一行的状态行，避免正文里出现同样的字样被误判。
 * 前后允许少量 Markdown 装饰（** / ## / 空格），模型偶尔会加。
 */
const STATUS_LINE = /^[\s#*>_-]*STATUS:\s*(FOUND|GENERAL|NOT_FOUND)[\s*_.-]*$/i;

/**
 * 剥离状态行，返回状态和正文。
 * 状态行缺失时返回 null —— 此时保守沿用模型原文（不截断用户可见内容）。
 */
function parseStatus(raw: string): { status: AnswerStatus | null; answer: string } {
	const lines = (raw ?? '').split('\n');
	// 只看前 3 行：状态行约定在首位，留一点容错
	for (let i = 0; i < Math.min(lines.length, 3); i++) {
		const matched = STATUS_LINE.exec(lines[i].replace(/\r$/, ''));
		if (!matched) continue;

		const rest = lines.slice();
		rest.splice(i, 1);
		return {
			status: matched[1].toUpperCase() as AnswerStatus,
			answer: rest.join('\n').replace(/^\s*\n+/, '').trim(),
		};
	}
	return { status: null, answer: (raw ?? '').trim() };
}

export async function runChat(
	request: ChatRequest,
	deps: ChatDeps
): Promise<ChatResponse> {
	const message = request.message.trim();
	if (!message) {
		throw new Error('EMPTY_MESSAGE');
	}

	const results = await deps.search.search(message, { topK: deps.topK ?? 5 });

	// 一条都没检索到：直接返回固定文案，不调模型。
	// 这是 V1 的刻意选择——宁可"没找到"，也不让模型用通用知识冒充 MyBo 的经验。
	if (!results || results.length === 0) {
		return { answer: NO_KNOWLEDGE_MESSAGE, sources: [] };
	}

	const context = buildKnowledgeContext(results);
	const userPrompt = buildUserPrompt(message, context);
	const history = sanitizeHistory(request.history);

	const output = await deps.model.generate({
		system: SYSTEM_PROMPT,
		messages: [...history, { role: 'user', content: userPrompt }],
	});

	const { status, answer } = parseStatus(output.text);

	// 知识库没有可支撑的材料：不给来源，也不让模型的推断冒充 MyBo 的记录
	if (status === 'NOT_FOUND') {
		return { answer: NO_KNOWLEDGE_MESSAGE, sources: [] };
	}

	// 纯一般技术建议：没有知识库依据，所以来源为空，并强制带上免责声明
	if (status === 'GENERAL') {
		const withNotice =
			answer.includes('一般技术建议') || answer.includes('不代表 MyBo')
				? answer
				: answer + GENERAL_ADVICE_NOTICE;
		return { answer: withNotice, sources: [] };
	}

	return {
		answer,
		sources: toSources(results),
	};
}
