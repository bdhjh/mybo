// ============================================================
// 全站 UI 文案字典
// ------------------------------------------------------------
// 约定：
//   zh 为默认语言（服务端渲染的就是 zh，见 Layout.astro）
//   en 在浏览器端由 data-zh / data-en 属性切换，不产生新路由
// 新增文案时：在页面/组件上写 data-zh={...} data-en={...} 即可；
// 被多处复用的固定文案才放这里。
// ============================================================

export interface I18nText {
	zh: string;
	en: string;
}

export const ui = {
	/* 导航 */
	'nav.home': { zh: '首页', en: 'Home' },
	'nav.projects': { zh: '项目', en: 'Projects' },
	'nav.lab': { zh: '实验室', en: 'Lab' },
	'nav.notes': { zh: '笔记', en: 'Notes' },
	'nav.about': { zh: '关于', en: 'About' },

	/* 通用动作 */
	'action.viewAll': { zh: '查看全部', en: 'View all' },
	'action.backTo.projects': { zh: '返回项目列表', en: 'Back to Projects' },
	'action.backTo.experiments': { zh: '返回实验列表', en: 'Back to Experiments' },
	'action.backTo.notes': { zh: '返回笔记列表', en: 'Back to Notes' },
	'label.breadcrumb': { zh: '面包屑', en: 'Breadcrumb' },

	/* 伪终端封面里的字段名 */
	'label.status': { zh: '状态', en: 'Status' },
	'label.date': { zh: '日期', en: 'Date' },

	/* 状态徽章：schema 里的 status 枚举 → 展示文案 */
	'status.active': { zh: '进行中', en: 'Active' },
	'status.completed': { zh: '已完成', en: 'Completed' },
	'status.archived': { zh: '已归档', en: 'Archived' },
	'status.running': { zh: '进行中', en: 'Running' },
	'status.idea': { zh: '构想', en: 'Idea' },
} as const satisfies Record<string, I18nText>;

export type UIKey = keyof typeof ui;

/** 取一条字典文案，未命中时回落为 key 本身，避免页面直接崩 */
export const t = (key: UIKey): I18nText => ui[key] ?? { zh: key, en: key };
