// ============================================================
// 英文内容层
// ------------------------------------------------------------
// 为什么放在这里，而不是加 src/content/**/*.en.md：
//   1) 不改动 content.config.ts 的 schema，也不新增 Collection；
//   2) 不会让 Content Collection 多出条目（避免生成重复路由）；
//   3) 三个 md 文件一个字节都没动。
// 约定：key = Content Collection 里的文件 id（不含扩展名）。
// 修改中文 md 时，请顺手同步这里的英文。
// ============================================================

export interface EntryEn {
	/** 英文标题（对应 frontmatter.title） */
	title: string;
	/** 英文描述（对应 frontmatter.description） */
	description: string;
	/** 英文正文，纯 HTML 片段，会被 .prose-mybo 排版接管（勿写 h1） */
	html: string;
}

/** projects 集合 */
export const projectsEn: Record<string, EntryEn> = {
	mybo: {
		title: 'MyBo',
		description: 'A personal AI lab and intelligent systems hub.',
		html: `
<p>MyBo is a personal lab for continuously building, experimenting with, and documenting AI applications.</p>
<p>What gets recorded here:</p>
<ul>
	<li>AI Automation</li>
	<li>AI Agents</li>
	<li>Workflows</li>
	<li>Local AI</li>
	<li>AI application practice</li>
	<li>Project retrospectives</li>
</ul>
<p>The core loop:</p>
<p><strong>Explore → Build → Use → Learn → Share → Iterate</strong></p>
<p>MyBo is not meant to be an ordinary blog. The goal is to turn long-term practice into systems and assets that can actually be reused.</p>
`,
	},
};

/** experiments 集合 */
export const experimentsEn: Record<string, EntryEn> = {
	'first-ai-automation': {
		title: 'First AI Automation Experiment',
		description:
			'Documenting the first experiment that brought AI, workflows, and automation into a real working process.',
		html: `
<p>This is the first AI automation experiment on MyBo.</p>
<p>Goals of the experiment:</p>
<ul>
	<li>Explore how AI can take part in real working processes</li>
	<li>Validate how Workflow and AI fit together</li>
	<li>Document the problems and solutions found along the way</li>
	<li>Turn the results into a reusable method</li>
</ul>
<h2>Current status</h2>
<p>The experiment is running.</p>
<p>What will keep being recorded:</p>
<ul>
	<li>The experiment process</li>
	<li>Problems encountered</li>
	<li>Solutions</li>
	<li>Final results</li>
	<li>Lessons that can be reused</li>
</ul>
`,
	},
};

/** notes 集合 */
export const notesEn: Record<string, EntryEn> = {
	'why-mybo': {
		title: 'Why I started MyBo',
		description: 'Notes on why I started building a personal AI lab of my own.',
		html: `
<p>AI tools keep multiplying, but what matters is not how many of them you can use. What matters is whether AI genuinely becomes part of your work and your life.</p>
<p>So I started building MyBo.</p>
<p>MyBo is not an ordinary blog, and it is not just a directory of tools.</p>
<p>It is closer to a personal AI lab that keeps running.</p>
<p>What gets recorded here:</p>
<ul>
	<li>The projects I am building</li>
	<li>AI automation experiments</li>
	<li>Agent and Workflow practice</li>
	<li>Local AI experiments</li>
	<li>Real problems from real work</li>
	<li>Project retrospectives and lessons learned</li>
</ul>
<h2>The MyBo loop</h2>
<p><strong>Explore → Build → Use → Learn → Share → Iterate</strong></p>
<p>Through continuous building, I want scattered experience with AI tools to settle into systems and assets that are truly reusable.</p>
<p>That is why MyBo exists.</p>
`,
	},
};

/** 安全取用：条目没有英文时返回 undefined，页面自动只显示中文 */
export const getEntryEn = (
	map: Record<string, EntryEn>,
	id: string
): EntryEn | undefined => map[id];
