/**
 * Model Layer —— 模型抽象。
 *
 * chat.ts 只认识 ModelProvider 这个接口，不认识 Workers AI、OpenAI 或任何具体模型。
 * 换模型 = 换一个 Provider 实现 + 改一个环境变量，业务流程不动。
 */

export interface ChatTurn {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

export interface ModelInput {
	/** System Prompt */
	system: string;
	/** 完整的消息序列：最近对话 + 当前问题（检索上下文已并入当前这一轮） */
	messages: ChatTurn[];
	maxTokens?: number;
}

export interface ModelOutput {
	text: string;
	/** 实际使用的模型标识，便于排障与日志 */
	model: string;
}

export interface ModelProvider {
	readonly id: string;
	generate(input: ModelInput): Promise<ModelOutput>;
}

// ---------------------------------------------------------------------------
// Provider 1：Cloudflare Workers AI（V1 默认）
// ---------------------------------------------------------------------------

/** Workers AI 不同模型的返回形状不完全一致，这里统一收敛成字符串 */
interface WorkersAIRawResult {
	response?: string;
	choices?: Array<{ message?: { content?: string }; text?: string }>;
	output_text?: string;
}

function extractText(raw: unknown): string {
	if (typeof raw === 'string') return raw;
	if (!raw || typeof raw !== 'object') return '';

	const r = raw as WorkersAIRawResult;
	if (typeof r.response === 'string' && r.response) return r.response;
	if (typeof r.output_text === 'string' && r.output_text) return r.output_text;
	const content = r.choices?.[0]?.message?.content;
	if (typeof content === 'string' && content) return content;
	const text = r.choices?.[0]?.text;
	if (typeof text === 'string' && text) return text;
	return '';
}

export interface WorkersAIOptions {
	ai: {
		run(
			model: string,
			input: Record<string, unknown>
		): Promise<unknown>;
	};
	model: string;
}

export function createWorkersAIProvider(options: WorkersAIOptions): ModelProvider {
	const { ai, model } = options;

	return {
		id: `workers-ai:${model}`,
		async generate(input) {
			const messages: ChatTurn[] = [
				{ role: 'system', content: input.system },
				...input.messages,
			];

			const raw = await ai.run(model, {
				messages,
				max_tokens: input.maxTokens ?? 1024,
				// 低温：V1.1 靠模型遵守「状态行 + A/B/C 分段」协议，采样越随机越容易跑偏
				temperature: 0.2,
			});

			const text = extractText(raw);
			if (!text) {
				throw new Error('Workers AI returned an empty response');
			}
			return { text, model };
		},
	};
}

// ---------------------------------------------------------------------------
// Provider 2：OpenAI 兼容接口（预留）
//
// V1 不需要任何 Secret。将来要接 OpenAI / 兼容网关时：
//   1) wrangler secret put OPENAI_API_KEY
//   2) 把环境变量 MODEL_PROVIDER 设为 "openai"
// 业务流程（chat.ts）与检索层都不需要改。
// ---------------------------------------------------------------------------

export interface OpenAICompatibleOptions {
	apiKey: string;
	model: string;
	baseUrl?: string;
	fetchImpl?: typeof fetch;
}

export function createOpenAICompatibleProvider(
	options: OpenAICompatibleOptions
): ModelProvider {
	const {
		apiKey,
		model,
		baseUrl = 'https://api.openai.com/v1',
		fetchImpl = fetch,
	} = options;

	return {
		id: `openai:${model}`,
		async generate(input) {
			const res = await fetchImpl(`${baseUrl}/chat/completions`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({
					model,
					messages: [{ role: 'system', content: input.system }, ...input.messages],
					max_tokens: input.maxTokens ?? 1024,
				}),
			});

			if (!res.ok) {
				// 只抛一个不含响应体的错误，避免密钥或上游细节进日志
				throw new Error(`Upstream model request failed (${res.status})`);
			}

			const data = (await res.json()) as {
				choices?: Array<{ message?: { content?: string } }>;
			};
			const text = data.choices?.[0]?.message?.content ?? '';
			if (!text) throw new Error('Upstream model returned an empty response');
			return { text, model };
		},
	};
}
