/**
 * Search Layer —— 知识检索抽象。
 *
 * chat.ts 只认识 KnowledgeSearch 这个接口，不认识 Cloudflare AI Search。
 * 将来换 Vectorize / 其他检索实现，只需要再写一个满足 KnowledgeSearch 的工厂函数，
 * chat.ts、prompt.ts、API 路由一行都不用改。
 */

// ---------------------------------------------------------------------------
// 对外的统一结构（chat.ts / index.ts 只消费这些）
// ---------------------------------------------------------------------------

export interface SearchSource {
	/** 可读标题，用于来源卡片 */
	title: string;
	/** MyBo 站内公开链接，例如 /projects/mybo —— 这是唯一允许给前端的地址 */
	url?: string;
	/** 内部对象键（R2 key）。仅内部使用，绝不返回前端、绝不进 Prompt */
	path?: string;
	/** 内容性质：ai-automation / personal-lab / website-engineering */
	category?: string;
}

export interface SearchResult {
	content: string;
	source: SearchSource;
	score?: number;
}

export interface SearchOptions {
	topK?: number;
}

export interface KnowledgeSearch {
	search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
}

// ---------------------------------------------------------------------------
// Cloudflare AI Search 的最小类型定义
// （workers-types 里还没有这部分，自己声明，避免依赖生成产物的版本）
// ---------------------------------------------------------------------------

interface AISearchItem {
	/** 源文件路径（R2 object key） */
	key: string;
	timestamp: number;
	metadata?: Record<string, unknown>;
}

interface AISearchChunk {
	id: string;
	type: string;
	score: number;
	text: string;
	item: AISearchItem;
}

interface AISearchResponse {
	search_query: string;
	chunks: AISearchChunk[];
	errors?: Array<{ instance_id?: string; message: string }>;
}

interface AISearchInstance {
	search(input: {
		messages: Array<{ role: string; content: string }>;
	}): Promise<AISearchResponse>;
}

// ---------------------------------------------------------------------------
// 知识清单（manifest）—— 由 scripts/sync-ai-knowledge.ts 生成，用于把对象键映射成
// 「可读标题 + 站内 URL」。检索本身返回的是 text + key，key 里没有中文标题。
// ---------------------------------------------------------------------------

export interface KnowledgeEntry {
	id: string;
	type: 'projects' | 'experiments' | 'notes';
	title: string;
	description: string;
	/** 站内 URL，已经过"转小写"处理，与 Astro 实际路由一致 */
	url: string;
	category?: string;
	tools?: string[];
	status?: string;
	date?: string;
}

export interface KnowledgeManifest {
	generatedAt: string;
	entries: KnowledgeEntry[];
}

export type ManifestLoader = () => Promise<KnowledgeManifest | null>;

// ---------------------------------------------------------------------------
// 实现：Cloudflare AI Search
// ---------------------------------------------------------------------------

export interface CloudflareAISearchOptions {
	instance: AISearchInstance;
	loadManifest: ManifestLoader;
}

/**
 * 对象键 → 站内 URL 的兜底推导。
 *
 * 注意：Astro 的 glob loader 会把文件 id 转小写（中文保留），
 * 所以 URL 不是文件名的原样复制。manifest 缺失时只能靠 key 推，
 * 而 key 在同步时已经按同一规则转过小写，所以这里是安全的。
 */
function urlFromKey(key: string): string {
	const cleaned = key
		.replace(/^kb\//, '') // 去掉同步前缀
		.replace(/\.md$/i, '') // 去掉扩展名
		.replace(/^\/+/, '');
	return `/${cleaned}`;
}

function titleFromKey(key: string): string {
	const cleaned = key.replace(/^kb\//, '').replace(/\.md$/i, '');
	const last = cleaned.split('/').pop() ?? cleaned;
	return last;
}

export function createCloudflareAISearch(
	options: CloudflareAISearchOptions
): KnowledgeSearch {
	const { instance, loadManifest } = options;

	return {
		async search(query, opts) {
			const topK = opts?.topK ?? 5;

			// 只传 messages。结果条数由我们自己截断，避免依赖可能变动的参数名。
			const response = await instance.search({
				messages: [{ role: 'user', content: query }],
			});

			if (response.errors && response.errors.length > 0) {
				// 只记日志，不把 Cloudflare 的错误详情抛给前端
				console.error(
					'[ai-search] instance errors:',
					response.errors.map((e) => e.message).join('; ')
				);
			}

			const manifest = await loadManifest();
			const byKey = new Map<string, KnowledgeEntry>();
			if (manifest) {
				for (const entry of manifest.entries) {
					byKey.set(`${entry.type}/${entry.id}.md`, entry);
				}
			}

			const chunks = Array.isArray(response.chunks) ? response.chunks : [];

			return chunks.slice(0, topK).map<SearchResult>((chunk) => {
				const key = chunk.item?.key ?? '';
				const entry = byKey.get(key.replace(/^kb\//, ''));

				return {
					content: chunk.text ?? '',
					score: typeof chunk.score === 'number' ? chunk.score : undefined,
					source: {
						title: entry?.title ?? titleFromKey(key),
						url: entry?.url ?? urlFromKey(key),
						path: key,
						category: entry?.category,
					},
				};
			});
		},
	};
}
