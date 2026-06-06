import {
	App, Plugin, PluginSettingTab, Setting,
	Menu, Modal, MarkdownView, Editor,
	Notice, requestUrl, RequestUrlParam, WorkspaceLeaf, TFile
} from 'obsidian';

import { RelayItem, RELAY_PORT, RelayTarget } from './relay-types';
import { RelayServer } from './relay-server';
import { RelayView, VIEW_TYPE_RELAY } from './relay-view';

// ═══════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════

interface ProviderPreset { name: string; baseUrl: string; models: string[]; }
interface PromptTemplate { name: string; desc: string; prompt: string; }
interface HistoryItem { id: string; timestamp: number; mode: string; selectedText: string; prompt: string; response: string; model: string; }

type AIMode = 'summary' | 'search' | 'translate' | 'rewrite' | 'code-explain' | 'table-extract';

interface ProviderConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	fetchedModels: string[];
}

interface SearchAISettings {
	currentProvider: string;
	providerConfigs: Record<string, ProviderConfig>;
	searchEngine: string;
	maxTokens: number;
	summaryPrompt: string; searchPrompt: string; translatePrompt: string;
	rewritePrompt: string; codeExplainPrompt: string; tableExtractPrompt: string;
	extractNotePrompt: string; targetLanguage: string; rewriteStyle: string;
	newNoteFolder: string;
	history: HistoryItem[];
	compareModels: string[];
	relayItems: RelayItem[];
	relayRetentionDays: number;
}

// ═══════════════════════════════════════════════════════════
// 预设
// ═══════════════════════════════════════════════════════════

const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
	openai:   { name: 'OpenAI',            baseUrl: 'https://api.openai.com/v1',         models: ['gpt-4o','gpt-4o-mini','gpt-4-turbo'] },
	deepseek: { name: 'DeepSeek',           baseUrl: 'https://api.deepseek.com/v1',       models: ['deepseek-chat','deepseek-reasoner'] },
	siliconflow: { name: '硅基流动',        baseUrl: 'https://api.siliconflow.cn/v1',     models: ['Qwen/Qwen2.5-72B-Instruct','deepseek-ai/DeepSeek-V3','deepseek-ai/DeepSeek-R1','meta-llama/Meta-Llama-3.1-70B-Instruct'] },
	mimo:     { name: 'MiMo (小米)',        baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', models: ['mimo-v2.5-pro','mimo-v2.5','mimo-v2-pro','mimo-v2-omni'] },
	moonshot: { name: '月之暗面',           baseUrl: 'https://api.moonshot.cn/v1',        models: ['moonshot-v1-128k','moonshot-v1-32k','moonshot-v1-8k'] },
	zhipu:    { name: '智谱 AI (GLM)',      baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-plus','glm-4-flash','glm-4-long','glm-4-air'] },
	qwen:     { name: '通义千问',           baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max','qwen-plus','qwen-turbo','qwen-long'] },
	doubao:   { name: '豆包 (字节)',        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', models: ['doubao-1.5-pro-256k','doubao-1.5-lite-32k'] },
	custom:   { name: '自定义',             baseUrl: '',                                    models: [] }
};

const SUMMARY_T: PromptTemplate[] = [
	{ name: '通用总结', desc: '提取要点', prompt: '请分析并总结以下文本，提取要点、重要概念，并用原文相同的语言给出简要解释：\n\n{text}' },
	{ name: '清单式', desc: '要点清单', prompt: '请用简洁的要点清单总结以下内容（以 "- " 开头），每条不超过两行，不超过8条：\n\n{text}' },
];
const SEARCH_T: PromptTemplate[] = [
	{ name: '通用搜索', desc: '全面解答', prompt: '请搜索并整理关于以下主题的信息，提供全面的解答：\n\n{text}' },
	{ name: '百科风格', desc: '百科全书', prompt: '请像百科全书一样，详细介绍以下主题：\n\n{text}' },
];
const TRANSLATE_T: PromptTemplate[] = [
	{ name: '通用翻译', desc: '标准翻译', prompt: '请将以下文本翻译成{lang}，保持原意和风格：\n\n{text}' },
];
const REWRITE_T: PromptTemplate[] = [
	{ name: '精简提炼', desc: '缩减50%', prompt: '请将以下文本精简提炼，去掉冗余，保留核心：\n\n{text}' },
	{ name: '扩展丰富', desc: '扩展一倍', prompt: '请将以下文本扩展丰富，增加细节：\n\n{text}' },
	{ name: '学术风格', desc: '正式论文', prompt: '请将以下文本改写为学术风格：\n\n{text}' },
];
const CODE_T: PromptTemplate[] = [
	{ name: '逐行解释', desc: '逐行注释', prompt: '请逐行解释以下代码：\n\n```\n{text}\n```' },
];
const TABLE_T: PromptTemplate[] = [
	{ name: '通用提取', desc: '结构化表格', prompt: '请从以下文本中提取结构化数据，生成 Markdown 表格。只输出表格：\n\n{text}' },
];

const MODE_META: Record<AIMode, { emoji: string; label: string }> = {
	summary:   { emoji: '🧠', label: '总结' },
	search:    { emoji: '🔍', label: '搜索' },
	translate: { emoji: '🌐', label: '翻译' },
	rewrite:   { emoji: '✍️',  label: '改写' },
	'code-explain': { emoji: '💻', label: '代码' },
	'table-extract': { emoji: '📊', label: '表格' },
};

const ALL_PROMPT_KEYS = ['summaryPrompt','searchPrompt','translatePrompt','rewritePrompt','codeExplainPrompt','tableExtractPrompt','extractNotePrompt'];

function defProviderCfg(p: string): ProviderConfig {
	const pr = PROVIDER_PRESETS[p];
	return { apiKey: '', baseUrl: pr?.baseUrl || '', model: pr?.models[0] || '', fetchedModels: [] };
}

const DEFAULT_SETTINGS: SearchAISettings = {
	currentProvider: 'deepseek',
	providerConfigs: { deepseek: { apiKey: '', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', fetchedModels: [] } },
	searchEngine: 'google', maxTokens: 1024,
	summaryPrompt: '请分析并总结以下文本，提取要点：\n\n{text}',
	searchPrompt: '请搜索并整理关于以下主题的信息：\n\n{text}',
	translatePrompt: '请将以下文本翻译成{lang}：\n\n{text}',
	rewritePrompt: '请改写以下文本：\n\n{text}',
	codeExplainPrompt: '请解释以下代码：\n\n```\n{text}\n```',
	tableExtractPrompt: '请提取表格：\n\n{text}',
	extractNotePrompt: '请整理成笔记，包含标题（# 开头）、摘要、核心内容、要点总结：\n\n{text}',
	targetLanguage: '中文', rewriteStyle: '精简提炼', newNoteFolder: '',
	history: [], compareModels: [],
	relayItems: [],
	relayRetentionDays: 0
};

// ═══════════════════════════════════════════════════════════
// 辅助
// ═══════════════════════════════════════════════════════════

function activeCfg(s: SearchAISettings): ProviderConfig {
	if (!s.providerConfigs[s.currentProvider]) s.providerConfigs[s.currentProvider] = defProviderCfg(s.currentProvider);
	return s.providerConfigs[s.currentProvider];
}

function fmt(ts: number) {
	const d = new Date(ts);
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parseRelaySummary(raw: string): { summary: string; tags: string[] } {
	const text = String(raw || '').trim();
	const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text;
	try {
		const parsed = JSON.parse(jsonText);
		const summary = String(parsed.summary || '').trim().slice(0, 500);
		const tags = Array.isArray(parsed.tags)
			? parsed.tags.map((tag: unknown) => String(tag).replace(/^#/, '').trim()).filter(Boolean).slice(0, 3)
			: [];
		return { summary: summary || text.slice(0, 160), tags };
	} catch {
		const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
		const tags = (text.match(/#[\p{L}\p{N}_-]+/gu) || []).map(tag => tag.slice(1)).slice(0, 3);
		return { summary: (lines[0] || text).slice(0, 500), tags };
	}
}

function formatRelayDuration(seconds: number) {
	const total = Math.max(0, Math.floor(seconds));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════
// AI 请求
// ═══════════════════════════════════════════════════════════

async function callAI(s: SearchAISettings, userPrompt: string, overrideProvider?: string, overrideModel?: string): Promise<{ content: string; model: string }> {
	const prov = overrideProvider || s.currentProvider;
	const cfg = s.providerConfigs[prov] || defProviderCfg(prov);
	const model = overrideModel || cfg.model;
	const url = `${cfg.baseUrl}/chat/completions`;
	const bodyStr = JSON.stringify({
		model,
		messages: [{ role: 'system', content: '你是一个有用的助手' }, { role: 'user', content: userPrompt }],
		max_tokens: s.maxTokens,
		temperature: 0.3
	});

	console.log('[SearchAI] callAI →', prov, '|', url, '|', model, '| keyLen:', cfg.apiKey?.length);

	let response;
	try {
		response = await requestUrl({
			url, method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
			body: bodyStr
		});
	} catch (e: any) {
		if (e?.status === 401 && !cfg.apiKey.startsWith('Bearer ')) {
			console.log('[SearchAI] Bearer 格式 401，尝试不带 Bearer...');
			try {
				response = await requestUrl({
					url, method: 'POST',
					headers: { 'Content-Type': 'application/json', 'Authorization': cfg.apiKey },
					body: bodyStr
				});
			} catch (e2: any) {
				console.log('[SearchAI] 不带 Bearer 也失败:', e2?.message, '| status:', e2?.status);
				throw e;
			}
		} else {
			throw e;
		}
	}

	console.log('[SearchAI] 响应状态:', response.status);
	const rawText = typeof response.text === 'string' ? response.text : '';
	let data: any;
	if (response.json && typeof response.json === 'object') data = response.json;
	else { try { data = JSON.parse(rawText); } catch { throw new Error(`非法 JSON (${response.status}): ${rawText.slice(0, 200)}`); } }
	if (data.error) throw new Error(`API: ${data.error.message || JSON.stringify(data.error)}`);
	return { content: data.choices?.[0]?.message?.content || '', model };
}

function renderText(text: string, c: HTMLElement) {
	const lines = text.split('\n'); let inCode = false, buf: string[] = [];
	function f() { if (buf.length) { const pre = c.createEl('pre',{cls:'sai-code'}); pre.createEl('code',{text:buf.join('\n')}); buf=[]; } }
	for (const l of lines) {
		if (l.trim().startsWith('```')) { inCode=!inCode; if(!inCode)f(); continue; }
		if (inCode) { buf.push(l); continue; }
		if (l.startsWith('### ')) c.createEl('h4',{text:l.slice(4)});
		else if (l.startsWith('## ')) c.createEl('h4',{text:l.slice(3)});
		else if (l.startsWith('# ')) c.createEl('h3',{text:l.slice(2)});
		else if (l.match(/^\d+\.\s/)) c.createEl('p',{text:l,cls:'sai-num'});
		else if (l.startsWith('- ')||l.startsWith('* ')) { const li=c.createEl('li',{text:l.slice(2)}); li.style.marginLeft='1em'; }
		else if (l.trim()==='') c.createEl('br');
		else c.createEl('p',{text:l});
	}
	f();
}

// ═══════════════════════════════════════════════════════════
// AI 命令面板（支持导航：主页/对比/历史）
// ═══════════════════════════════════════════════════════════

type PanelView = 'main' | 'compare' | 'history';

class AICommandPanel extends Modal {
	private plugin: SearchAIPlugin;
	private selectedText: string;
	private resultArea!: HTMLElement;
	private inputArea!: HTMLInputElement;
	private panelProvider: string;
	private panelModel: string;
	private currentView: PanelView = 'main';
	private isRunning = false;
	private abortFlag = false;
	private lastMode: AIMode | null = null;

	constructor(app: App, plugin: SearchAIPlugin) {
		super(app);
		this.plugin = plugin;
		const av = plugin.app.workspace.getActiveViewOfType(MarkdownView);
		this.selectedText = av?.editor.getSelection() || '';
		const s = plugin.settings;
		const providers = Object.entries(s.providerConfigs).filter(([,c]) => c?.apiKey);
		if (providers.length > 0 && !s.providerConfigs[s.currentProvider]?.apiKey) {
			this.panelProvider = providers[0][0];
		} else {
			this.panelProvider = s.currentProvider;
		}
		this.panelModel = (s.providerConfigs[this.panelProvider] || defProviderCfg(this.panelProvider)).model;
	}

	onOpen() { this.renderView(); }
	onClose() { this.contentEl.empty(); }

	// ── 导航 ──
	private navigateTo(view: PanelView) {
		this.currentView = view;
		this.renderView();
	}

	private renderView() {
		this.contentEl.empty();
		this.contentEl.addClass('sai-panel');
		switch (this.currentView) {
			case 'main': this.renderMain(); break;
			case 'compare': this.renderCompareView(); break;
			case 'history': this.renderHistoryView(); break;
		}
	}

	// ═══════════════════════════════════════════════
	// 主视图
	// ═══════════════════════════════════════════════
	private renderMain() {
		const { contentEl } = this;

		// 标题栏
		const header = contentEl.createDiv({ cls: 'sai-header' });
		header.createEl('span', { text: '🤖 AI 助手', cls: 'sai-title' });

		// 供应商下拉
		const provSel = header.createEl('select', { cls: 'sai-prov-select' });
		for (const [k, v] of Object.entries(PROVIDER_PRESETS)) {
			if (k === 'custom') continue;
			const opt = document.createElement('option'); opt.value = k; opt.textContent = v.name;
			if (k === this.panelProvider) opt.selected = true;
			provSel.appendChild(opt);
		}
		provSel.addEventListener('change', () => {
			this.panelProvider = provSel.value;
			const cfg = this.plugin.settings.providerConfigs[this.panelProvider] || defProviderCfg(this.panelProvider);
			this.panelModel = cfg.model;
			this.refreshModelSelect(header.querySelector('.sai-model-select') as HTMLSelectElement);
		});

		// 模型下拉
		const modelSel = header.createEl('select', { cls: 'sai-model-select' });
		this.refreshModelSelect(modelSel);
		modelSel.addEventListener('change', () => { this.panelModel = modelSel.value; });

		// 源文本预览
		const preview = contentEl.createDiv({ cls: 'sai-preview' });
		preview.createEl('strong', { text: '📋 ' });
		preview.createEl('span', { text: this.selectedText.length > 150 ? this.selectedText.slice(0,150)+'...' : this.selectedText || '（可自由提问或选择功能）' });

		// 功能按钮
		const toolbar = contentEl.createDiv({ cls: 'sai-toolbar' });
		const modes: { mode: AIMode; emoji: string; label: string }[] = [
			{ mode: 'summary', emoji: '🧠', label: '总结' },
			{ mode: 'search', emoji: '🔍', label: '搜索' },
			{ mode: 'translate', emoji: '🌐', label: '翻译' },
			{ mode: 'rewrite', emoji: '✍️', label: '改写' },
			{ mode: 'code-explain', emoji: '💻', label: '代码' },
			{ mode: 'table-extract', emoji: '📊', label: '表格' },
		];
		for (const m of modes) {
			toolbar.createDiv({ cls: 'sai-tool-btn', text: `${m.emoji} ${m.label}` }).onclick = () => this.runMode(m.mode);
		}
		toolbar.createDiv({ cls: 'sai-tool-btn sai-tool-btn-special', text: '⚖️ 对比' }).onclick = () => this.navigateTo('compare');
		toolbar.createDiv({ cls: 'sai-tool-btn sai-tool-btn-special', text: '📝 提取笔记' }).onclick = () => { this.close(); this.plugin.extractToNote(this.selectedText || ''); };
		toolbar.createDiv({ cls: 'sai-tool-btn sai-tool-btn-special', text: '📜 历史' }).onclick = () => this.navigateTo('history');

		// 结果区
		this.resultArea = contentEl.createDiv({ cls: 'sai-result' });

		// 输入
		const footer = contentEl.createDiv({ cls: 'sai-footer' });
		this.inputArea = footer.createEl('input', { cls: 'sai-input', placeholder: '自定义提问（回车发送）...' });
		this.inputArea.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && this.inputArea.value.trim()) {
				this.runCustom(this.inputArea.value.trim());
				this.inputArea.value = '';
			}
		});
	}

	// ═══════════════════════════════════════════════
	// 对比视图
	// ═══════════════════════════════════════════════
	private renderCompareView() {
		const { contentEl } = this;

		// 顶栏：返回 + 标题
		const header = contentEl.createDiv({ cls: 'sai-header' });
		header.createEl('button', { text: '← 返回', cls: 'sai-back-btn' }).onclick = () => this.navigateTo('main');
		header.createEl('span', { text: '⚖️ 多模型对比', cls: 'sai-title' });

		// 源文本
		const preview = contentEl.createDiv({ cls: 'sai-preview' });
		preview.createEl('span', { text: this.selectedText.length > 100 ? this.selectedText.slice(0,100)+'...' : this.selectedText || '（无选中文本）' });

		// 收集所有可用模型
		const entries = this.getAllAvailableModels();
		if (entries.length < 2) {
			contentEl.createDiv({ cls: 'sai-error' }).createEl('p', { text: '⚠️ 至少需要 2 个已配置 Key 的服务商才能对比' });
			return;
		}

		// 模型选择
		const selDiv = contentEl.createDiv({ cls: 'sai-compare-select' });
		selDiv.createEl('div', { text: '勾选要对比的模型：', cls: 'sai-section-label' });

		const cbs: { entry: typeof entries[0]; cb: HTMLInputElement }[] = [];
		const list = selDiv.createDiv({ cls: 'sai-compare-list' });
		for (const e of entries) {
			const row = list.createDiv({ cls: 'sai-compare-row' });
			const cb = row.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
			cb.checked = true;
			row.createEl('label', { text: e.label });
			cbs.push({ entry: e, cb });
		}

		selDiv.createDiv({ cls: 'sai-compare-quick' })
			.createEl('button', { text: '全选 / 全不选', cls: 'sai-btn sai-btn-gray' }).onclick = () => {
				const any = cbs.some(c => !c.cb.checked);
				cbs.forEach(c => c.cb.checked = any);
			};

		// 开始对比
		selDiv.createDiv({ cls: 'sai-result-btns' }).createEl('button', { text: '🚀 开始对比', cls: 'sai-btn' }).onclick = async () => {
			const selected = cbs.filter(c => c.cb.checked).map(c => c.entry);
			if (selected.length < 2) { new Notice('请至少选 2 个'); return; }
			await this.doCompare(selected);
		};

		// 结果区
		this.resultArea = contentEl.createDiv({ cls: 'sai-result' });
	}

	/** 收集所有已配置 Key 的供应商的全部模型 */
	private getAllAvailableModels(): { provider: string; model: string; label: string }[] {
		const s = this.plugin.settings;
		const result: { provider: string; model: string; label: string }[] = [];
		for (const [key, cfg] of Object.entries(s.providerConfigs)) {
			if (!cfg.apiKey) continue;
			const name = PROVIDER_PRESETS[key]?.name || key;
			const preset = PROVIDER_PRESETS[key]?.models || [];
			const allModels = [...new Set([cfg.model, ...preset, ...cfg.fetchedModels].filter(Boolean))];
			for (const m of allModels) {
				result.push({ provider: key, model: m, label: `${name}: ${m}` });
			}
		}
		return result;
	}

	private async doCompare(entries: { provider: string; model: string; label: string }[]) {
		this.isRunning = true;
		this.abortFlag = false;
		this.showLoading('⏳ 并行请求所有模型...');

		// 停止按钮
		const stopBtn = this.resultArea.createDiv({ cls: 'sai-stop-container' })
			.createEl('button', { text: '⏹ 停止', cls: 'sai-stop-btn' });
		stopBtn.onclick = () => {
			this.abortFlag = true;
			stopBtn.textContent = '⏹ 停止中...';
			(stopBtn as HTMLButtonElement).disabled = true;
		};

		const s = this.plugin.settings;
		const prompt = s.searchPrompt.replace(/\{text\}/g, this.selectedText);
		const results = await Promise.allSettled(entries.map(e => callAI(s, prompt, e.provider, e.model)));

		this.isRunning = false;
		if (this.abortFlag) { this.showStopped(); return; }

		this.resultArea.empty();
		const grid = this.resultArea.createDiv({ cls: 'sai-compare-grid' });
		results.forEach((r, i) => {
			const col = grid.createDiv({ cls: 'sai-compare-col' });
			col.createEl('div', { text: entries[i].label, cls: 'sai-compare-model-name' });
			const body = col.createDiv({ cls: 'sai-compare-body sai-output' });
			if (r.status === 'fulfilled') {
				renderText(r.value.content, body);
				this.plugin.addHistory('compare', this.selectedText, prompt, r.value.content, r.value.model);
			} else {
				body.createEl('p', { text: `❌ ${(r.reason as any)?.message || String(r.reason)}`, cls: 'sai-error' });
			}
		});
	}

	// ═══════════════════════════════════════════════
	// 历史视图
	// ═══════════════════════════════════════════════
	private renderHistoryView() {
		const { contentEl } = this;

		// 顶栏：返回 + 标题
		const header = contentEl.createDiv({ cls: 'sai-header' });
		header.createEl('button', { text: '← 返回', cls: 'sai-back-btn' }).onclick = () => this.navigateTo('main');
		header.createEl('span', { text: '📜 历史记录', cls: 'sai-title' });

		const h = [...this.plugin.settings.history].reverse();
		if (!h.length) {
			contentEl.createDiv({ cls: 'sai-preview' }).createEl('span', { text: '暂无历史记录' });
			return;
		}

		const list = contentEl.createDiv({ cls: 'sai-history-list' });
		for (const item of h) {
			const card = list.createDiv({ cls: 'sai-history-card' });
			const hdr = card.createDiv({ cls: 'sai-history-hdr' });
			const meta = MODE_META[item.mode as AIMode];
			hdr.createEl('span', { text: `${meta?.emoji||'🤖'} ${meta?.label||item.mode} | ${item.model}`, cls: 'sai-history-mode' });
			hdr.createEl('span', { text: fmt(item.timestamp), cls: 'sai-history-time' });
			card.createEl('div', { text: item.selectedText.slice(0,100)+(item.selectedText.length>100?'...':''), cls: 'sai-history-preview' });
			const det = card.createDiv({ cls: 'sai-history-detail' }); det.style.display = 'none'; renderText(item.response, det);
			const btns = card.createDiv({ cls: 'sai-history-btns' });
			const tgl = btns.createEl('button', { text: '展开 ▼', cls: 'sai-btn sai-btn-gray' });
			tgl.onclick = () => { const v = det.style.display !== 'none'; det.style.display = v ? 'none' : 'block'; tgl.textContent = v ? '展开 ▼' : '收起 ▲'; };
			btns.createEl('button', { text: '📋', cls: 'sai-btn' }).onclick = async () => { await navigator.clipboard.writeText(item.response); new Notice('已复制'); };
			btns.createEl('button', { text: '🗑️', cls: 'sai-btn sai-btn-red' }).onclick = () => {
				this.plugin.settings.history = this.plugin.settings.history.filter(x => x.id !== item.id);
				this.plugin.saveSettings();
				card.remove();
				// 如果清空了最后一条，刷新视图
				if (!this.plugin.settings.history.length) this.renderHistoryView();
			};
		}

		// 清空按钮 — 立即刷新
		contentEl.createDiv({ cls: 'sai-result-btns' }).createEl('button', { text: '🗑️ 清空全部', cls: 'sai-btn sai-btn-red' }).onclick = async () => {
			this.plugin.settings.history = [];
			await this.plugin.saveSettings();
			this.renderHistoryView(); // 立即刷新，不用重新打开
		};
	}

	// ═══════════════════════════════════════════════
	// 运行模式
	// ═══════════════════════════════════════════════
	private refreshModelSelect(sel: HTMLSelectElement | null) {
		if (!sel) return;
		sel.innerHTML = '';
		const cfg = this.plugin.settings.providerConfigs[this.panelProvider] || defProviderCfg(this.panelProvider);
		const preset = PROVIDER_PRESETS[this.panelProvider]?.models || [];
		const all = [...new Set([cfg.model, ...preset, ...cfg.fetchedModels].filter(Boolean))];
		for (const m of all) {
			const opt = document.createElement('option'); opt.value = m; opt.textContent = m;
			if (m === this.panelModel) opt.selected = true;
			sel.appendChild(opt);
		}
	}

	private async runMode(mode: AIMode) {
		const s = this.plugin.settings;
		const cfg = s.providerConfigs[this.panelProvider] || defProviderCfg(this.panelProvider);
		if (!cfg.apiKey) { new Notice(`⚠️ 请先在设置中配置 ${PROVIDER_PRESETS[this.panelProvider]?.name} 的 API Key`); return; }

		let prompt = '';
		switch (mode) {
			case 'summary': prompt = s.summaryPrompt.replace(/\{text\}/g, this.selectedText); break;
			case 'search': prompt = s.searchPrompt.replace(/\{text\}/g, this.selectedText); break;
			case 'translate': prompt = s.translatePrompt.replace(/\{text\}/g, this.selectedText).replace(/\{lang\}/g, s.targetLanguage); break;
			case 'rewrite': prompt = s.rewritePrompt.replace(/\{text\}/g, this.selectedText); break;
			case 'code-explain': prompt = s.codeExplainPrompt.replace(/\{text\}/g, this.selectedText); break;
			case 'table-extract': prompt = s.tableExtractPrompt.replace(/\{text\}/g, this.selectedText); break;
		}

		this.lastMode = mode;
		await this.executeAI(prompt, mode);
	}

	private async runCustom(text: string) {
		const s = this.plugin.settings;
		const cfg = s.providerConfigs[this.panelProvider] || defProviderCfg(this.panelProvider);
		if (!cfg.apiKey) { new Notice(`⚠️ 请先配置 ${PROVIDER_PRESETS[this.panelProvider]?.name} 的 API Key`); return; }
		const prompt = this.selectedText ? `参照以下内容：\n\n${this.selectedText}\n\n问题：${text}` : text;
		this.lastMode = null;
		await this.executeAI(prompt, 'chat');
	}

	private async executeAI(prompt: string, mode: string) {
		this.isRunning = true;
		this.abortFlag = false;
		this.showLoading();

		// 停止按钮
		const stopBtn = this.resultArea.createDiv({ cls: 'sai-stop-container' })
			.createEl('button', { text: '⏹ 停止', cls: 'sai-stop-btn' });
		stopBtn.onclick = () => {
			this.abortFlag = true;
			stopBtn.textContent = '⏹ 停止中...';
			(stopBtn as HTMLButtonElement).disabled = true;
		};

		try {
			const s = this.plugin.settings;
			const { content, model } = await callAI(s, prompt, this.panelProvider, this.panelModel);
			if (this.abortFlag) { this.showStopped(); return; }
			this.plugin.addHistory(mode, this.selectedText, prompt, content, model);
			this.renderResult(content, model);
		} catch (e: any) {
			if (this.abortFlag) { this.showStopped(); return; }
			this.showError(e);
		} finally {
			this.isRunning = false;
		}
	}

	// ═══════════════════════════════════════════════
	// 结果渲染
	// ═══════════════════════════════════════════════
	private renderResult(content: string, model: string) {
		this.resultArea.empty();
		this.resultArea.createDiv({ text: `模型: ${model}`, cls: 'sai-model-badge' });

		// 输出区 — 支持文本选择
		const outputDiv = this.resultArea.createDiv({ cls: 'sai-output' });
		outputDiv.setAttribute('style', 'user-select: text; -webkit-user-select: text;');
		renderText(content, outputDiv);

		const btns = this.resultArea.createDiv({ cls: 'sai-result-btns' });
		btns.createEl('button', { text: '📋 复制全部', cls: 'sai-btn' }).onclick = async () => {
			await navigator.clipboard.writeText(content);
			new Notice('已复制');
		};
		btns.createEl('button', { text: '✂️ 复制选中', cls: 'sai-btn sai-btn-gray' }).onclick = async () => {
			const sel = window.getSelection()?.toString();
			if (sel) { await navigator.clipboard.writeText(sel); new Notice('已复制选中内容'); }
			else { new Notice('请先用鼠标选中文本'); }
		};
		btns.createEl('button', { text: '📝 插入笔记', cls: 'sai-btn sai-btn-gray' }).onclick = () => {
			const av = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
			if (av) { av.editor.replaceSelection(content); new Notice('已插入'); this.close(); }
		};
		if (this.lastMode && this.lastMode !== 'search') {
			btns.createEl('button', { text: '🔄 替换原文', cls: 'sai-btn sai-btn-gray' }).onclick = () => {
				const av = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
				if (av) { av.editor.replaceSelection(content); new Notice('已替换'); this.close(); }
			};
		}
	}

	private showLoading(msg = '⏳ 正在处理...') {
		this.resultArea.empty();
		this.resultArea.createDiv({ text: msg, cls: 'sai-loading' });
	}

	private showStopped() {
		this.resultArea.empty();
		this.resultArea.createDiv({ text: '⏹ 已停止', cls: 'sai-stopped' });
	}

	private showError(e: any) {
		this.resultArea.empty();
		const div = this.resultArea.createDiv({ cls: 'sai-error' });
		div.createEl('p', { text: `❌ ${e?.message || String(e)}` });
		div.createEl('p', { text: '查看控制台获取详细信息', cls: 'sai-error' }).style.fontSize = '0.8em';
	}
}

// ═══════════════════════════════════════════════════════════
// 历史弹窗（独立入口：命令/设置页打开）
// ═══════════════════════════════════════════════════════════

class HistoryModal extends Modal {
	private plugin: SearchAIPlugin;
	constructor(app: App, p: SearchAIPlugin) { super(app); this.plugin = p; }
	onOpen() { this.render(); }

	private render() {
		const c = this.contentEl; c.empty(); c.addClass('sai-panel');
		c.createEl('h2', { text: '📜 历史', cls: 'sai-title' });
		const h = [...this.plugin.settings.history].reverse();
		if (!h.length) { c.createEl('p', { text: '暂无' }); return; }
		const list = c.createDiv({ cls: 'sai-history-list' });
		for (const item of h) {
			const card = list.createDiv({ cls: 'sai-history-card' });
			const hdr = card.createDiv({ cls: 'sai-history-hdr' });
			const meta = MODE_META[item.mode as AIMode];
			hdr.createEl('span', { text: `${meta?.emoji||'🤖'} ${meta?.label||item.mode} | ${item.model}`, cls: 'sai-history-mode' });
			hdr.createEl('span', { text: fmt(item.timestamp), cls: 'sai-history-time' });
			card.createEl('div', { text: item.selectedText.slice(0,100)+(item.selectedText.length>100?'...':''), cls: 'sai-history-preview' });
			const det = card.createDiv({ cls: 'sai-history-detail' }); det.style.display = 'none'; renderText(item.response, det);
			const btns = card.createDiv({ cls: 'sai-history-btns' });
			const tgl = btns.createEl('button', { text: '展开 ▼', cls: 'sai-btn sai-btn-gray' });
			tgl.onclick = () => { const v = det.style.display !== 'none'; det.style.display = v ? 'none' : 'block'; tgl.textContent = v ? '展开 ▼' : '收起 ▲'; };
			btns.createEl('button', { text: '📋', cls: 'sai-btn' }).onclick = async () => { await navigator.clipboard.writeText(item.response); new Notice('已复制'); };
			btns.createEl('button', { text: '🗑️', cls: 'sai-btn sai-btn-red' }).onclick = () => {
				this.plugin.settings.history = this.plugin.settings.history.filter(x => x.id !== item.id);
				this.plugin.saveSettings();
				card.remove();
				if (!this.plugin.settings.history.length) this.render();
			};
		}
		// 清空 — 立即刷新
		c.createDiv({ cls: 'sai-result-btns' }).createEl('button', { text: '🗑️ 清空全部', cls: 'sai-btn sai-btn-red' }).onclick = async () => {
			this.plugin.settings.history = [];
			await this.plugin.saveSettings();
			this.render(); // 立即刷新
		};
	}
	onClose() { this.contentEl.empty(); }
}

// ═══════════════════════════════════════════════════════════
// 提取到新笔记
// ═══════════════════════════════════════════════════════════

class ExtractNoteModal extends Modal {
	private plugin: SearchAIPlugin; private text: string; private content: string = '';
	constructor(app: App, text: string, p: SearchAIPlugin) { super(app); this.text = text; this.plugin = p; }
	async onOpen() {
		const c=this.contentEl;c.empty();c.addClass('sai-panel');c.createEl('h2',{text:'📝 提取到新笔记',cls:'sai-title'});
		const ca=c.createDiv({cls:'sai-result'});ca.createDiv({text:'⏳ AI 整理中...',cls:'sai-loading'});
		try {
			const s=this.plugin.settings;const prompt=s.extractNotePrompt.replace(/\{text\}/g,this.text);
			const {content:cnt}=await callAI(s,prompt);this.content=cnt;this.plugin.addHistory('extract-note',this.text,prompt,cnt,activeCfg(s).model);
			ca.empty();renderText(cnt,ca.createDiv({cls:'sai-output'}));
			const tm=cnt.match(/^#\s*(.+)/m);const def=(tm?tm[1].trim():'新笔记').replace(/[/\\:*?"<>|]/g,'');
			ca.createEl('div',{text:'文件名：',cls:'sai-section-label'});
			const inp=ca.createEl('input',{value:def});inp.style.cssText='width:100%;padding:6px 10px;margin:6px 0 10px;border:1px solid var(--background-modifier-border);border-radius:4px;';
			const btns=ca.createDiv({cls:'sai-result-btns'});
			btns.createEl('button',{text:'取消',cls:'sai-btn sai-btn-gray'}).onclick=()=>this.close();
			btns.createEl('button',{text:'✅ 创建',cls:'sai-btn'}).onclick=async()=>{
				const title=inp.value.trim()||def;const folder=s.newNoteFolder||'';const fp=folder?`${folder}/${title}.md`:`${title}.md`;
				try{this.plugin.app.vault.create(fp,this.content);new Notice(`✅ ${fp}`);this.close();}catch{
					const ts=new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
					const alt=folder?`${folder}/${title} ${ts}.md`:`${title} ${ts}.md`;
					await this.plugin.app.vault.create(alt,this.content);new Notice(`✅ ${alt}`);this.close();
				}
			};
		}catch(e:any){ca.empty();ca.createDiv({cls:'sai-error'}).createEl('p',{text:`❌ ${e?.message||String(e)}`});}
	}
	onClose(){this.contentEl.empty();}
}

// ═══════════════════════════════════════════════════════════
// 测试弹窗
// ═══════════════════════════════════════════════════════════

class TestResultModal extends Modal {
	constructor(app: App, private success: boolean, private result: string) { super(app); }
	onOpen() {
		const c=this.contentEl;c.empty();c.addClass('sai-panel');
		c.createEl('h2',{text:this.success?'✅ 连接成功':'❌ 连接失败',cls:this.success?'sai-success':'sai-error'});
		c.createDiv({cls:'sai-preview'}).createEl('pre',{text:this.result,cls:'sai-pre'});
		c.createDiv({cls:'sai-result-btns'}).createEl('button',{text:'关闭',cls:'sai-btn'}).onclick=()=>this.close();
	}
	onClose(){this.contentEl.empty();}
}

// ═══════════════════════════════════════════════════════════
// 主插件
// ═══════════════════════════════════════════════════════════

export default class SearchAIPlugin extends Plugin {
	settings: SearchAISettings;
	private relayServer!: RelayServer;
	private relayView: RelayView | null = null;

	async onload() {
		await this.loadSettings();

		// ── 注册侧边栏中转站视图 ──
		this.registerView(VIEW_TYPE_RELAY, (leaf) => {
			this.relayView = new RelayView(
				leaf,
				() => this.settings.relayItems,
				(items) => { this.settings.relayItems = items; },
				() => this.saveSettings(),
				(id) => this.summarizeRelayItem(id)
			);
			return this.relayView;
		});

		// ── 启动 HTTP 服务器 ──
		this.relayServer = new RelayServer(
			() => this.settings.relayItems,
			(items) => {
				this.settings.relayItems = items;
				this.saveSettings();
				this.relayView?.refresh(items);
			},
			{
				listTargets: () => this.listRelayTargets(),
				appendToTarget: (itemId, targetPath) => this.appendRelayItemToTarget(itemId, targetPath),
				createNoteFromItem: (itemId, targetPath) => this.createNoteFromRelayItem(itemId, targetPath),
				summarizeItem: (itemId) => this.summarizeRelayItemForApi(itemId),
			}
		);
		this.relayServer.onEvent((event, data) => {
			console.log('[Relay] 事件:', event, data);
			this.relayView?.refresh(this.settings.relayItems);
		});
		this.relayServer.start();

		this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
			const sel = editor.getSelection(); if (!sel?.trim()) return;
			menu.addSeparator();
			menu.addItem(it => it.setTitle('🔍 浏览器搜索').setIcon('search').onClick(() => this.searchInBrowser(sel)));
			menu.addItem(it => it.setTitle('🤖 AI 处理').setIcon('wand').onClick(() => this.openPanel()));
			menu.addItem(it => it.setTitle('📝 提取到新笔记').setIcon('file-plus').onClick(() => this.extractToNote(sel)));
			menu.addSeparator();
		}));

		this.addCommand({ id: 'ai-panel', name: '打开 AI 命令面板', hotkeys: [{ modifiers: ['Ctrl','Shift'], key: 'K' }], callback: () => this.openPanel() });
		this.addCommand({ id: 'ai-history', name: '查看 AI 使用历史', callback: () => new HistoryModal(this.app, this).open() });
		this.addCommand({ id: 'search-browser', name: '浏览器搜索选中文本', editorCallback: () => { const s = this.getSel(); if (s) this.searchInBrowser(s); } });
		this.addCommand({ id: 'ai-extract-note', name: '提取选中内容到新笔记', editorCallback: () => { const s = this.getSel(); if (s) this.extractToNote(s); } });
		this.addCommand({ id: 'open-relay', name: '打开中转站侧边栏', callback: () => this.activateRelayView() });

		this.addSettingTab(new SearchAISettingTab(this.app, this));
		console.log('[SearchAI] v4 — 多服务商 + 中转站');
	}

	getSel() { const av = this.app.workspace.getActiveViewOfType(MarkdownView); const s = av?.editor.getSelection()?.trim(); if (!s) new Notice('请先选中文本'); return s || null; }
	onunload() {
		this.relayServer.stop();
		console.log('[SearchAI] 已卸载');
	}

	// ── 激活中转站侧边栏 ──
	async activateRelayView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_RELAY);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getLeftLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE_RELAY, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}

	listRelayTargets(): RelayTarget[] {
		const files = this.app.vault.getMarkdownFiles().map(file => ({
			type: 'file' as const,
			path: file.path,
			name: file.basename,
		}));
		const folderPaths = new Set<string>();
		for (const file of this.app.vault.getMarkdownFiles()) {
			const parts = file.path.split('/').slice(0, -1);
			for (let i = 1; i <= parts.length; i++) folderPaths.add(parts.slice(0, i).join('/'));
		}
		const folders = Array.from(folderPaths).filter(Boolean).sort().map(path => ({
			type: 'folder' as const,
			path,
			name: path.split('/').pop() || path,
		}));
		return [...folders, ...files].sort((a, b) => a.path.localeCompare(b.path));
	}

	async appendRelayItemToTarget(itemId: string, targetPath: string): Promise<{ ok: boolean; path?: string; error?: string }> {
		const item = this.settings.relayItems.find(i => i.id === itemId);
		if (!item) return { ok: false, error: 'Item not found' };
		const file = this.app.vault.getAbstractFileByPath(targetPath);
		if (!(file instanceof TFile)) return { ok: false, error: 'Target note not found' };
		const existing = await this.app.vault.read(file);
		await this.app.vault.modify(file, existing + '\n\n' + this.formatRelayItemForNote(item));
		item.targetPath = file.path;
		item.updatedAt = Date.now();
		await this.saveSettings();
		this.relayView?.refresh(this.settings.relayItems);
		return { ok: true, path: file.path };
	}

	async createNoteFromRelayItem(itemId: string, targetPath: string): Promise<{ ok: boolean; path?: string; error?: string }> {
		const item = this.settings.relayItems.find(i => i.id === itemId);
		if (!item) return { ok: false, error: 'Item not found' };
		const folder = targetPath.replace(/\\/g, '/').replace(/\/+$/, '');
		const safeTitle = (item.title || item.type || 'relay-item').replace(/[\\/:*?"<>|#^[\]]/g, '-').slice(0, 80) || 'relay-item';
		const stamp = new Date(item.createdAt || Date.now()).toISOString().slice(0, 10);
		const path = `${folder ? folder + '/' : ''}${stamp} ${safeTitle}.md`;
		const uniquePath = await this.uniqueVaultPath(path);
		if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
		await this.app.vault.create(uniquePath, this.formatRelayItemForNote(item));
		item.targetPath = uniquePath;
		item.updatedAt = Date.now();
		await this.saveSettings();
		this.relayView?.refresh(this.settings.relayItems);
		return { ok: true, path: uniquePath };
	}

	async summarizeRelayItemForApi(itemId: string): Promise<{ ok: boolean; item?: RelayItem; result?: { summary: string; tags: string[] }; error?: string }> {
		try {
			const item = await this.summarizeRelayItem(itemId);
			if (!item) return { ok: false, error: 'Item not found' };
			return { ok: true, item, result: { summary: item.summary || '', tags: item.tags || [] } };
		} catch (e: any) {
			return { ok: false, error: e?.message || String(e) };
		}
	}

	async summarizeRelayItem(itemId: string): Promise<RelayItem | null> {
		const item = this.settings.relayItems.find(i => i.id === itemId);
		if (!item) return null;
		const cfg = activeCfg(this.settings);
		if (!cfg?.apiKey) throw new Error('Please configure an AI API key in Obsidian settings first.');
		const prompt = [
			'请阅读下面这条中转站内容，返回严格 JSON，不要输出额外解释。',
			'JSON 格式：{"summary":"不超过120字摘要","tags":["标签1","标签2","标签3"]}',
			'标签只返回 3 个，短词，不带 #。',
			'',
			`标题：${item.title || ''}`,
			`链接：${item.url || item.sourceUrl || ''}`,
			'内容：',
			item.content.slice(0, 6000),
		].join('\n');
		const { content, model } = await callAI(this.settings, prompt);
		const parsed = parseRelaySummary(content);
		item.summary = parsed.summary;
		item.tags = parsed.tags;
		item.updatedAt = Date.now();
		this.addHistory('relay-summary', item.content.slice(0, 500), prompt, content, model);
		await this.saveSettings();
		this.relayView?.refresh(this.settings.relayItems);
		return item;
	}

	formatRelayItemForNote(item: RelayItem): string {
		const meta: string[] = [];
		if (item.title) meta.push(`# ${item.title}`);
		if (item.url || item.sourceUrl) meta.push(`Source: ${item.url || item.sourceUrl}`);
		if (item.videoTimestamp !== undefined) meta.push(`Timestamp: ${formatRelayDuration(item.videoTimestamp)}`);
		if (item.summary) meta.push(`Summary: ${item.summary}`);
		if (item.tags?.length) meta.push(`Tags: ${item.tags.map(t => `#${t}`).join(' ')}`);
		const body = item.type === 'image'
			? `![](${item.content})`
			: item.type === 'url' || item.type === 'video'
				? `[${item.title || item.content}](${item.content})`
				: item.content;
		return [...meta, '', body].filter(Boolean).join('\n');
	}

	private async uniqueVaultPath(path: string): Promise<string> {
		if (!this.app.vault.getAbstractFileByPath(path)) return path;
		const dot = path.lastIndexOf('.');
		const base = dot === -1 ? path : path.slice(0, dot);
		const ext = dot === -1 ? '' : path.slice(dot);
		for (let i = 2; i < 1000; i++) {
			const candidate = `${base} ${i}${ext}`;
			if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
		}
		return `${base} ${Date.now()}${ext}`;
	}

	async loadSettings() {
		const loaded = await this.loadData() || {};
		console.log('[SearchAI] loadSettings raw loaded keys:', Object.keys(loaded));
		console.log('[SearchAI] loadSettings providerConfigs:', JSON.stringify(loaded.providerConfigs ? Object.keys(loaded.providerConfigs) : 'NONE'));

		this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

		if ((loaded as any).apiKey && !this.settings.providerConfigs?.[this.settings.currentProvider]?.apiKey) {
			const p = (loaded as any).provider || this.settings.currentProvider || 'deepseek';
			this.settings.providerConfigs[p] = {
				apiKey: (loaded as any).apiKey || '',
				baseUrl: (loaded as any).apiBaseUrl || PROVIDER_PRESETS[p]?.baseUrl || '',
				model: (loaded as any).model || PROVIDER_PRESETS[p]?.models[0] || '',
				fetchedModels: (loaded as any).allFetchedModels || []
			};
			this.settings.currentProvider = p;
			console.log('[SearchAI] 迁移旧格式到:', p);
		}

		if (!this.settings.providerConfigs) this.settings.providerConfigs = {};
		if (!this.settings.providerConfigs[this.settings.currentProvider]) {
			this.settings.providerConfigs[this.settings.currentProvider] = defProviderCfg(this.settings.currentProvider);
		}

		for (const k of ALL_PROMPT_KEYS) if (!(this.settings as any)[k]) (this.settings as any)[k] = (DEFAULT_SETTINGS as any)[k];
		if (!this.settings.history) this.settings.history = [];
		if (!this.settings.compareModels) this.settings.compareModels = [];

		console.log('[SearchAI] loadSettings done, providers with keys:', Object.entries(this.settings.providerConfigs).filter(([,c]) => c.apiKey).map(([k]) => k));
	}

	async saveSettings() {
		console.log('[SearchAI] saveSettings providerConfigs:', JSON.stringify(Object.keys(this.settings.providerConfigs || {})));
		await this.saveData(JSON.parse(JSON.stringify(this.settings)));
	}

	searchInBrowser(text: string) { const q=encodeURIComponent(text.trim()); const u:Record<string,string>={google:`https://www.google.com/search?q=${q}`,bing:`https://www.bing.com/search?q=${q}`,baidu:`https://www.baidu.com/s?wd=${q}`}; window.open(u[this.settings.searchEngine]||u.google,'_blank'); }
	openPanel() {
		const hasAnyKey = Object.values(this.settings.providerConfigs).some(c => c?.apiKey);
		if (!hasAnyKey) { new Notice('⚠️ 请先配置 API Key'); this.app.setting.open(); return; }
		new AICommandPanel(this.app, this).open();
	}
	extractToNote(text: string) { if (!activeCfg(this.settings).apiKey) { new Notice('⚠️ 请先配置 API Key'); this.app.setting.open(); return; } new ExtractNoteModal(this.app, text, this).open(); }

	addHistory(mode: string, selectedText: string, prompt: string, response: string, model: string) {
		this.settings.history.push({ id: String(Date.now())+Math.random().toString(36).slice(2,6), timestamp: Date.now(), mode, selectedText, prompt, response, model });
		if (this.settings.history.length > 50) this.settings.history = this.settings.history.slice(-50);
		this.saveSettings();
	}

	async testConnection(provider: string) {
		const s = this.settings;
		const cfg = s.providerConfigs[provider];
		if (!cfg?.apiKey) return { success: false, message: 'API Key 为空' };
		try {
			const { content } = await callAI(s, '你好，回复 OK', provider, cfg.model);
			return { success: true, message: `✅ ${PROVIDER_PRESETS[provider]?.name}: ${cfg.model}\n回复：${content}\n连接正常` };
		} catch (e: any) { return { success: false, message: `❌ ${e?.message || String(e)}` }; }
	}

	async fetchModels(provider: string): Promise<string[]> {
		const cfg = this.settings.providerConfigs[provider];
		if (!cfg?.apiKey || !cfg?.baseUrl) { console.log('[SearchAI] fetchModels skip: no key or url for', provider); return []; }
		try {
			const url = `${cfg.baseUrl}/models`;
			console.log('[SearchAI] fetchModels provider:', provider, '| url:', url, '| keyLen:', cfg.apiKey.length);
			const r = await requestUrl({ url, method: 'GET', headers: { 'Authorization': `Bearer ${cfg.apiKey}` } });
			console.log('[SearchAI] fetchModels status:', r.status);
			const models = (r.json.data || []).map((m: any) => m.id).filter(Boolean).sort();
			cfg.fetchedModels = models;
			await this.saveSettings();
			return models;
		} catch { return []; }
	}
}

// ═══════════════════════════════════════════════════════════
// 设置页面
// ═══════════════════════════════════════════════════════════

class SearchAISettingTab extends PluginSettingTab {
	plugin: SearchAIPlugin;
	private showingProvider: string;
	private activeTab: 'ai' | 'relay' = 'ai';

	constructor(app: App, p: SearchAIPlugin) { super(app, p); this.plugin = p; this.showingProvider = p.settings.currentProvider; }

	display() {
		const c = this.containerEl; c.empty(); const P = this.plugin; const S = P.settings;
		c.createEl('h2', { text: '搜索 & AI 助手 v4' });

		// ── 分栏导航 ──
		const nav = c.createDiv({ cls: 'sai-nav' });
		const tabAi = nav.createDiv({ cls: 'sai-nav-tab' + (this.activeTab === 'ai' ? ' active' : ''), text: '🤖 AI 助手' });
		const tabRelay = nav.createDiv({ cls: 'sai-nav-tab' + (this.activeTab === 'relay' ? ' active' : ''), text: '📋 中转站' });
		tabAi.onclick = () => { this.activeTab = 'ai'; this.display(); };
		tabRelay.onclick = () => { this.activeTab = 'relay'; this.display(); };
		c.createDiv({ cls: 'sai-nav-divider' });

		if (this.activeTab === 'ai') {
			this.renderAITab(c, P, S);
		} else {
			this.renderRelayTab(c, P, S);
		}
	}

	private renderAITab(c: HTMLElement, P: SearchAIPlugin, S: SearchAISettings) {
		// ── 搜索引擎 ──
		c.createEl('h3', { text: '🔍 搜索引擎' });
		new Setting(c).setName('默认引擎').addDropdown(d => d.addOption('google','Google').addOption('bing','Bing').addOption('baidu','百度').setValue(S.searchEngine).onChange(async v => { S.searchEngine = v; await P.saveSettings(); }));

		// ═══ 多服务商独立配置 ═══
		c.createEl('h3', { text: '🤖 AI 服务商' });

		new Setting(c).setName('当前编辑').setDesc('选择要编辑配置的服务商').addDropdown(d => {
			for (const [k, v] of Object.entries(PROVIDER_PRESETS)) { if (k === 'custom') continue; d.addOption(k, v.name); }
			d.setValue(this.showingProvider);
			d.onChange(v => { this.showingProvider = v; this.display(); });
		});

		const cfg = S.providerConfigs[this.showingProvider] || defProviderCfg(this.showingProvider);
		S.providerConfigs[this.showingProvider] = cfg;

		const ks = new Setting(c).setName('API Key').setDesc(`为 ${PROVIDER_PRESETS[this.showingProvider]?.name} 配置密钥`);
		ks.addText(t => { t.setPlaceholder('sk-...').setValue(cfg.apiKey).onChange(async v => { cfg.apiKey = v; await P.saveSettings(); }); t.inputEl.type = 'password'; t.inputEl.style.width = '300px'; });
		ks.addButton(b => b.setButtonText('👁️').buttonEl.addEventListener('click', () => { const i = ks.controlEl.querySelector('input') as HTMLInputElement; if (i) i.type = i.type === 'password' ? 'text' : 'password'; }));

		new Setting(c).setName('API 地址').setDesc(`${PROVIDER_PRESETS[this.showingProvider]?.baseUrl || '手动输入'}`)
			.addText(t => { t.setPlaceholder('https://api.example.com/v1').setValue(cfg.baseUrl).onChange(async v => { cfg.baseUrl = v; await P.saveSettings(); }); t.inputEl.style.width = '350px'; });

		const ms = new Setting(c).setName('默认模型');
		ms.addDropdown(d => {
			const all = [...new Set([cfg.model, ...(PROVIDER_PRESETS[this.showingProvider]?.models || []), ...cfg.fetchedModels].filter(Boolean))];
			for (const m of all) d.addOption(m, m);
			if (!all.includes(cfg.model)) d.addOption(cfg.model, cfg.model);
			d.setValue(cfg.model).onChange(async v => { cfg.model = v; await P.saveSettings(); });
			d.selectEl.style.width = '300px';
		});
		ms.addButton(b => { b.setButtonText('🔄 获取模型').buttonEl.style.fontSize = '12px'; b.onClick(async () => {
			if (!cfg.apiKey) { new Notice('⚠️ 先输入 API Key'); return; } b.setButtonText('⏳...'); b.setDisabled(true);
			const models = await P.fetchModels(this.showingProvider);
			new Notice(models.length ? `✅ ${models.length} 个模型已缓存` : '⚠️ 未获取到');
			b.setButtonText('🔄 获取模型'); b.setDisabled(false); this.display();
		}); });

		new Setting(c).setName('测试连接').addButton(b => b.setButtonText('🚀 测试').setCta().onClick(async () => {
			b.setButtonText('⏳...'); b.setDisabled(true);
			const r = await P.testConnection(this.showingProvider);
			new TestResultModal(this.app, r.success, r.message).open();
			b.setButtonText('🚀 测试'); b.setDisabled(false);
		}));

		new Setting(c).setName('默认供应商').setDesc('打开 AI 面板时默认使用哪个服务商')
			.addDropdown(d => {
				for (const [k, v] of Object.entries(PROVIDER_PRESETS)) { if (k === 'custom') continue; d.addOption(k, v.name); }
				d.setValue(S.currentProvider).onChange(async v => { S.currentProvider = v; await P.saveSettings(); });
			});

		// ── 通用设置 ──
		c.createEl('h3', { text: '⚙️ 通用设置' });
		new Setting(c).setName('最大 Token').addSlider(s => s.setLimits(256, 4096, 128).setValue(S.maxTokens).setDynamicTooltip().onChange(async v => { S.maxTokens = v; await P.saveSettings(); }));
		new Setting(c).setName('新笔记文件夹').setDesc('提取笔记的保存位置（留空=根目录）').addText(t => { t.setPlaceholder('AI笔记').setValue(S.newNoteFolder).onChange(async v => { S.newNoteFolder = v; await P.saveSettings(); }); t.inputEl.style.width = '250px'; });
		new Setting(c).setName('翻译目标语言').addText(t => { t.setPlaceholder('中文').setValue(S.targetLanguage).onChange(async v => { S.targetLanguage = v; await P.saveSettings(); }); t.inputEl.style.width = '150px'; });

		// ── 提示词 ──
		c.createEl('h3', { text: '📝 提示词' });
		c.createDiv({ cls: 'sai-tips' }).createEl('p', { text: '{text}=选中文本  {lang}=目标语言' });
		this.addPS(c, '总结', SUMMARY_T, 'summaryPrompt');
		this.addPS(c, '搜索', SEARCH_T, 'searchPrompt');
		this.addPS(c, '翻译', TRANSLATE_T, 'translatePrompt');
		this.addPS(c, '改写', REWRITE_T, 'rewritePrompt');
		this.addPS(c, '代码', CODE_T, 'codeExplainPrompt');
		this.addPS(c, '表格', TABLE_T, 'tableExtractPrompt');
		this.addPS(c, '提取笔记', [], 'extractNotePrompt');
		new Setting(c).setName('恢复默认').addButton(b => b.setButtonText('🔄 恢复').onClick(async () => { for (const k of ALL_PROMPT_KEYS)(S as any)[k]=(DEFAULT_SETTINGS as any)[k]; await P.saveSettings(); this.display(); }));

		// ── 历史 ──
		c.createEl('h3', { text: '📜 数据' });
		new Setting(c).setName(`历史：${S.history.length} 条`).addButton(b => b.setButtonText('📜 查看').onClick(() => new HistoryModal(this.app, P).open())).addButton(b => b.setButtonText('🗑️ 清空').onClick(async () => { S.history = []; await P.saveSettings(); this.display(); }));

		c.createEl('h3', { text: '💡 快捷键' });
		c.createDiv({ cls: 'sai-tips' }).createEl('p', { text: 'Ctrl+Shift+K → AI 命令面板  |  面板右上角可切换供应商和模型' });
	}

	private addPS(c: HTMLElement, title: string, templates: PromptTemplate[], key: string) {
		const d = c.createDiv({ cls: 'sai-ps' }); d.createEl('h4', { text: title });
		if (templates.length > 0) new Setting(d).setName('模板').addDropdown(dd => {
			dd.addOption('__custom__', '自定义');
			for (const t of templates) dd.addOption(t.name, `${t.name} - ${t.desc}`);
			dd.onChange(async v => { if (v !== '__custom__') { const t = templates.find(t => t.name === v); if (t) { (this.plugin.settings as any)[key] = t.prompt; await this.plugin.saveSettings(); this.display(); } } });
		});
		const ta = d.createEl('textarea', { cls: 'sai-prompt-ta', text: (this.plugin.settings as any)[key] });
		ta.rows = 3; ta.style.width = '100%'; ta.addEventListener('change', async () => { (this.plugin.settings as any)[key] = ta.value; await this.plugin.saveSettings(); });
	}

	// ═══════════════════════════════════════════
	// AI 助手设置页
	// ═══════════════════════════════════════════
	private renderAITab(c: HTMLElement, P: SearchAIPlugin, S: SearchAISettings) {
		// 搜索引擎
		c.createEl('h3', { text: '🔍 搜索引擎' });
		new Setting(c).setName('默认引擎').addDropdown(d => d.addOption('google','Google').addOption('bing','Bing').addOption('baidu','百度').setValue(S.searchEngine).onChange(async v => { S.searchEngine = v; await P.saveSettings(); }));

		// AI 服务商
		c.createEl('h3', { text: '🤖 AI 服务商' });
		new Setting(c).setName('当前编辑').setDesc('选择要编辑配置的服务商').addDropdown(d => {
			for (const [k, v] of Object.entries(PROVIDER_PRESETS)) { if (k === 'custom') continue; d.addOption(k, v.name); }
			d.setValue(this.showingProvider);
			d.onChange(v => { this.showingProvider = v; this.display(); });
		});

		const cfg = S.providerConfigs[this.showingProvider] || defProviderCfg(this.showingProvider);
		S.providerConfigs[this.showingProvider] = cfg;

		const ks = new Setting(c).setName('API Key').setDesc(`为 ${PROVIDER_PRESETS[this.showingProvider]?.name} 配置密钥`);
		ks.addText(t => { t.setPlaceholder('sk-...').setValue(cfg.apiKey).onChange(async v => { cfg.apiKey = v; await P.saveSettings(); }); t.inputEl.type = 'password'; t.inputEl.style.width = '300px'; });
		ks.addButton(b => b.setButtonText('👁️').buttonEl.addEventListener('click', () => { const i = ks.controlEl.querySelector('input') as HTMLInputElement; if (i) i.type = i.type === 'password' ? 'text' : 'password'; }));

		new Setting(c).setName('API 地址').setDesc(`${PROVIDER_PRESETS[this.showingProvider]?.baseUrl || '手动输入'}`)
			.addText(t => { t.setPlaceholder('https://api.example.com/v1').setValue(cfg.baseUrl).onChange(async v => { cfg.baseUrl = v; await P.saveSettings(); }); t.inputEl.style.width = '350px'; });

		const ms = new Setting(c).setName('默认模型');
		ms.addDropdown(d => {
			const all = [...new Set([cfg.model, ...(PROVIDER_PRESETS[this.showingProvider]?.models || []), ...cfg.fetchedModels].filter(Boolean))];
			for (const m of all) d.addOption(m, m);
			if (!all.includes(cfg.model)) d.addOption(cfg.model, cfg.model);
			d.setValue(cfg.model).onChange(async v => { cfg.model = v; await P.saveSettings(); });
			d.selectEl.style.width = '300px';
		});
		ms.addButton(b => { b.setButtonText('🔄 获取模型').buttonEl.style.fontSize = '12px'; b.onClick(async () => {
			if (!cfg.apiKey) { new Notice('⚠️ 先输入 API Key'); return; } b.setButtonText('⏳...'); b.setDisabled(true);
			const models = await P.fetchModels(this.showingProvider);
			new Notice(models.length ? `✅ ${models.length} 个模型已缓存` : '⚠️ 未获取到');
			b.setButtonText('🔄 获取模型'); b.setDisabled(false); this.display();
		}); });

		new Setting(c).setName('测试连接').addButton(b => b.setButtonText('🚀 测试').setCta().onClick(async () => {
			b.setButtonText('⏳...'); b.setDisabled(true);
			const r = await P.testConnection(this.showingProvider);
			new TestResultModal(this.app, r.success, r.message).open();
			b.setButtonText('🚀 测试'); b.setDisabled(false);
		}));

		new Setting(c).setName('默认供应商').setDesc('打开 AI 面板时默认使用哪个服务商')
			.addDropdown(d => {
				for (const [k, v] of Object.entries(PROVIDER_PRESETS)) { if (k === 'custom') continue; d.addOption(k, v.name); }
				d.setValue(S.currentProvider).onChange(async v => { S.currentProvider = v; await P.saveSettings(); });
			});

		// 通用设置
		c.createEl('h3', { text: '⚙️ 通用设置' });
		new Setting(c).setName('最大 Token').addSlider(s => s.setLimits(256, 4096, 128).setValue(S.maxTokens).setDynamicTooltip().onChange(async v => { S.maxTokens = v; await P.saveSettings(); }));
		new Setting(c).setName('新笔记文件夹').setDesc('提取笔记的保存位置（留空=根目录）').addText(t => { t.setPlaceholder('AI笔记').setValue(S.newNoteFolder).onChange(async v => { S.newNoteFolder = v; await P.saveSettings(); }); t.inputEl.style.width = '250px'; });
		new Setting(c).setName('翻译目标语言').addText(t => { t.setPlaceholder('中文').setValue(S.targetLanguage).onChange(async v => { S.targetLanguage = v; await P.saveSettings(); }); t.inputEl.style.width = '150px'; });

		// 提示词
		c.createEl('h3', { text: '📝 提示词' });
		c.createDiv({ cls: 'sai-tips' }).createEl('p', { text: '{text}=选中文本  {lang}=目标语言' });
		this.addPS(c, '总结', SUMMARY_T, 'summaryPrompt');
		this.addPS(c, '搜索', SEARCH_T, 'searchPrompt');
		this.addPS(c, '翻译', TRANSLATE_T, 'translatePrompt');
		this.addPS(c, '改写', REWRITE_T, 'rewritePrompt');
		this.addPS(c, '代码', CODE_T, 'codeExplainPrompt');
		this.addPS(c, '表格', TABLE_T, 'tableExtractPrompt');
		this.addPS(c, '提取笔记', [], 'extractNotePrompt');
		new Setting(c).setName('恢复默认').addButton(b => b.setButtonText('🔄 恢复').onClick(async () => { for (const k of ALL_PROMPT_KEYS)(S as any)[k]=(DEFAULT_SETTINGS as any)[k]; await P.saveSettings(); this.display(); }));

		// 历史
		c.createEl('h3', { text: '📜 数据' });
		new Setting(c).setName(`历史：${S.history.length} 条`).addButton(b => b.setButtonText('📜 查看').onClick(() => new HistoryModal(this.app, P).open())).addButton(b => b.setButtonText('🗑️ 清空').onClick(async () => { S.history = []; await P.saveSettings(); this.display(); }));

		c.createEl('h3', { text: '💡 快捷键' });
		c.createDiv({ cls: 'sai-tips' }).createEl('p', { text: 'Ctrl+Shift+K → AI 命令面板  |  面板右上角可切换供应商和模型' });
	}

	// ═══════════════════════════════════════════
	// 中转站设置页
	// ═══════════════════════════════════════════
	private renderRelayTab(c: HTMLElement, P: SearchAIPlugin, S: SearchAISettings) {
		c.createEl('h3', { text: '📋 中转站设置' });

		// 服务器状态
		const statusDiv = c.createDiv({ cls: 'sai-tips' });
		statusDiv.createEl('p', { text: `HTTP 服务器: localhost:${RELAY_PORT}  |  中转站内容: ${S.relayItems.length} 条` });

		// 自动清理
		c.createEl('h3', { text: '🗑️ 自动清理' });
		new Setting(c).setName('保留天数').setDesc('超过天数自动删除未收藏的内容（0=不清理）')
			.addDropdown(d => {
				d.addOption('0', '不清理');
				d.addOption('3', '3 天');
				d.addOption('7', '7 天');
				d.addOption('14', '14 天');
				d.addOption('30', '30 天');
				d.setValue(String(S.relayRetentionDays || 0));
				d.onChange(async v => { S.relayRetentionDays = parseInt(v); await P.saveSettings(); new Notice(`自动清理: ${v === '0' ? '关闭' : v + ' 天'}`); });
			});
		new Setting(c).setName('立即清理').setDesc('手动执行一次清理').addButton(b => b.setButtonText('🗑️ 清理').onClick(async () => {
			const cutoff = Date.now() - (S.relayRetentionDays || 7) * 86400000;
			const before = S.relayItems.length;
			S.relayItems = S.relayItems.filter(i => i.starred || i.createdAt > cutoff);
			await P.saveSettings();
			new Notice(`清理完成: 删除了 ${before - S.relayItems.length} 条`);
			this.display();
		}));

		// 数据管理
		c.createEl('h3', { text: '📦 数据管理' });
		new Setting(c).setName('导出全部').setDesc('导出中转站内容为 Markdown').addButton(b => b.setButtonText('📥 导出').onClick(async () => {
			let md = '# 中转站导出\n\n';
			for (const item of S.relayItems) {
				const time = new Date(item.createdAt).toLocaleString('zh-CN');
				md += `## ${item.type} - ${time}\n\n${item.content}\n\n---\n\n`;
			}
			await navigator.clipboard.writeText(md);
			new Notice('已复制到剪贴板');
		}));
		new Setting(c).setName('清空全部').setDesc('删除所有中转站内容（收藏的也会被删）')
			.addButton(b => b.setButtonText('🗑️ 清空').setWarning().onClick(async () => {
				S.relayItems = [];
				await P.saveSettings();
				new Notice('已清空');
				this.display();
			}));

		// 浏览器扩展
		c.createEl('h3', { text: '🌐 浏览器扩展' });
		c.createDiv({ cls: 'sai-tips' }).createEl('p', { text: '安装 browser-relay 文件夹为 Chrome 扩展，即可在浏览器中使用中转站功能。\n\n功能：\n• 右键发送文字/图片/链接到中转站\n• 网页剪藏（智能提取表格/代码）\n• 浮动面板管理内容\n• 收藏、批量操作、自动清理' });
	}
}
