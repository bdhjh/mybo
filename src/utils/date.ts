// ============================================================
// 日期格式化：同一份日期产出中英两种展示文案
// ------------------------------------------------------------
// 中文：2026/09/16      英文：Sep 16, 2026
// 页面里用 data-zh / data-en 同时挂上，切换语言时即时替换。
// ============================================================

export interface DateLabels {
	zh: string;
	en: string;
}

export const formatDates = (date: Date): DateLabels => ({
	zh: date.toLocaleDateString('zh-CN', {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		timeZone: 'UTC',
	}),
	en: date.toLocaleDateString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		timeZone: 'UTC',
	}),
});

/** 列表计数：项目数 / 实验数 / 笔记数 */
export const countLabel = (
	kind: 'project' | 'experiment' | 'note',
	n: number
): DateLabels => {
	const zh = { project: '项目数', experiment: '实验数', note: '笔记数' }[kind];
	const enBase = { project: 'project', experiment: 'experiment', note: 'note' }[
		kind
	];
	return { zh: `${zh}：${n}`, en: `${n} ${enBase}${n === 1 ? '' : 's'}` };
};
