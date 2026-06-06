import { ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { RelayItem } from './relay-types';

export const VIEW_TYPE_RELAY = 'relay-station-view';
type DateFilter = 'all' | 'today' | '7d' | '30d';

export class RelayView extends ItemView {
  private items: RelayItem[] = [];
  private listEl!: HTMLElement;
  private searchInput!: HTMLInputElement;
  private dateSelect!: HTMLSelectElement;
  private filter = '';
  private dateFilter: DateFilter = 'all';

  constructor(
    leaf: WorkspaceLeaf,
    private getItems: () => RelayItem[],
    private setItems: (items: RelayItem[]) => void,
    private saveSettings: () => void,
    private summarizeItem?: (id: string) => Promise<RelayItem | null>
  ) {
    super(leaf);
  }

  getViewType() { return VIEW_TYPE_RELAY; }
  getDisplayText() { return '中转站'; }
  getIcon() { return 'paste'; }

  async onOpen() {
    this.items = this.getItems();
    this.render();
  }

  async onClose() {}

  refresh(items: RelayItem[]) {
    this.items = items;
    if (this.listEl) this.renderList();
  }

  private render() {
    const container = this.contentEl;
    container.empty();
    container.addClass('relay-view');

    const header = container.createDiv({ cls: 'relay-view-header' });
    header.createEl('span', { text: '中转站', cls: 'relay-view-title' });
    const actions = header.createDiv({ cls: 'relay-view-actions' });
    actions.createEl('button', { text: '刷新', cls: 'relay-view-btn', title: '刷新列表' }).onclick = () => {
      this.items = this.getItems();
      this.renderList();
    };
    actions.createEl('button', { text: '清空', cls: 'relay-view-btn relay-view-btn-danger', title: '清空所有内容' }).onclick = () => {
      this.items = [];
      this.setItems(this.items);
      this.saveSettings();
      this.renderList();
      new Notice('中转站已清空');
    };

    const filters = container.createDiv({ cls: 'relay-view-filters' });
    this.searchInput = filters.createEl('input', {
      placeholder: '搜索内容、标题、链接、摘要、标签...',
      cls: 'relay-view-search-input',
    }) as HTMLInputElement;
    this.searchInput.addEventListener('input', () => {
      this.filter = this.searchInput.value.trim().toLowerCase();
      this.renderList();
    });

    this.dateSelect = filters.createEl('select', { cls: 'relay-view-date-select' }) as HTMLSelectElement;
    [
      ['all', '全部时间'],
      ['today', '今天'],
      ['7d', '最近 7 天'],
      ['30d', '最近 30 天'],
    ].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      this.dateSelect.appendChild(option);
    });
    this.dateSelect.addEventListener('change', () => {
      this.dateFilter = this.dateSelect.value as DateFilter;
      this.renderList();
    });

    this.listEl = container.createDiv({ cls: 'relay-view-list' });
    this.renderList();
  }

  private renderList() {
    this.items = this.getItems();
    this.listEl.empty();

    const filtered = this.items
      .filter((item) => this.matchesSearch(item))
      .filter((item) => this.matchesDate(item));
    const sorted = [...filtered].sort((a, b) => {
      const starDelta = Number(Boolean(b.starred)) - Number(Boolean(a.starred));
      return starDelta || (b.createdAt || 0) - (a.createdAt || 0);
    });

    if (!sorted.length) {
      this.listEl.createDiv({ cls: 'relay-view-empty', text: this.filter || this.dateFilter !== 'all' ? '无匹配结果' : '暂无内容' });
      return;
    }

    for (const item of sorted) this.renderItem(item);
  }

  private renderItem(item: RelayItem) {
    const card = this.listEl.createDiv({ cls: 'relay-view-card' + (item.starred ? ' starred' : '') });
    card.draggable = true;
    card.addEventListener('dragstart', (event) => {
      event.dataTransfer?.setData('text/plain', this.formatItem(item));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
    });

    const meta = card.createDiv({ cls: 'relay-view-meta' });
    const typeLabel = item.type === 'video' ? 'video' : item.type;
    const time = new Date(item.createdAt || Date.now()).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    meta.createEl('span', { text: `${typeLabel} · ${time}`, cls: 'relay-view-meta-text' });
    if (item.videoTimestamp !== undefined) meta.createEl('span', { text: ` · ${formatDuration(item.videoTimestamp)}`, cls: 'relay-view-meta-text' });

    if (item.type === 'image') {
      const img = card.createEl('img', { cls: 'relay-view-img' }) as HTMLImageElement;
      img.src = item.content;
      img.onerror = () => { img.style.display = 'none'; };
    } else if (item.type === 'url' || item.type === 'video') {
      card.createDiv({ cls: 'relay-view-content', text: item.title || item.content });
      const link = card.createEl('a', { cls: 'relay-view-link', text: item.content, href: item.content });
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else {
      card.createDiv({
        cls: 'relay-view-content',
        text: item.content.slice(0, 280) + (item.content.length > 280 ? '...' : ''),
      });
    }

    if (item.summary) {
      card.createDiv({ cls: 'relay-view-summary', text: item.summary });
    }
    if (item.tags?.length) {
      const tags = card.createDiv({ cls: 'relay-view-tags' });
      item.tags.forEach((tag) => tags.createEl('span', { cls: 'relay-view-tag', text: `#${tag}` }));
    }

    const btns = card.createDiv({ cls: 'relay-view-btns' });
    btns.createEl('button', { text: item.starred ? '取消收藏' : '收藏', cls: 'relay-view-btn' }).onclick = () => {
      item.starred = !item.starred;
      item.updatedAt = Date.now();
      this.persist();
    };
    btns.createEl('button', { text: '插入当前笔记', cls: 'relay-view-btn' }).onclick = () => this.addToCurrentNote(item);
    btns.createEl('button', { text: '追加到笔记', cls: 'relay-view-btn' }).onclick = () => this.appendToFile(item);
    btns.createEl('button', { text: 'AI 摘要', cls: 'relay-view-btn' }).onclick = () => this.runSummary(item);
    btns.createEl('button', { text: '复制', cls: 'relay-view-btn' }).onclick = async () => {
      await navigator.clipboard.writeText(this.formatItem(item));
      new Notice('已复制');
    };
    btns.createEl('button', { text: '删除', cls: 'relay-view-btn relay-view-btn-danger' }).onclick = () => {
      this.items = this.items.filter((entry) => entry.id !== item.id);
      this.persist();
    };
  }

  private matchesSearch(item: RelayItem) {
    if (!this.filter) return true;
    const haystack = [
      item.content,
      item.title,
      item.url,
      item.sourceUrl,
      item.summary,
      ...(item.tags || []),
    ].join(' ').toLowerCase();
    return haystack.includes(this.filter);
  }

  private matchesDate(item: RelayItem) {
    if (this.dateFilter === 'all') return true;
    const createdAt = item.createdAt || 0;
    const now = Date.now();
    if (this.dateFilter === 'today') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return createdAt >= d.getTime();
    }
    if (this.dateFilter === '7d') return createdAt >= now - 7 * 86400000;
    if (this.dateFilter === '30d') return createdAt >= now - 30 * 86400000;
    return true;
  }

  private addToCurrentNote(item: RelayItem) {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView) || this.findMarkdownView();
    if (!view) {
      new Notice('请先打开一个笔记');
      return;
    }
    view.editor.replaceSelection(this.formatItem(item));
    new Notice('已插入当前笔记');
  }

  private async appendToFile(item: RelayItem) {
    const files = this.app.vault.getMarkdownFiles();
    if (!files.length) {
      new Notice('没有可追加的 Markdown 笔记');
      return;
    }

    const path = await this.promptFile(files);
    if (!path) return;

    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      new Notice('未找到目标笔记');
      return;
    }

    const existing = await this.app.vault.read(file);
    await this.app.vault.modify(file, existing + '\n\n' + this.formatItem(item));
    item.targetPath = file.path;
    item.updatedAt = Date.now();
    this.persist();
    new Notice(`已追加到 ${file.basename}`);
  }

  private async runSummary(item: RelayItem) {
    if (!this.summarizeItem) {
      new Notice('AI 摘要不可用');
      return;
    }
    new Notice('正在生成摘要和标签...');
    const updated = await this.summarizeItem(item.id);
    if (!updated) {
      new Notice('AI 摘要失败');
      return;
    }
    this.items = this.getItems();
    this.renderList();
    new Notice('摘要和标签已生成');
  }

  private findMarkdownView() {
    const leaf = this.app.workspace.getLeavesOfType('markdown')[0];
    return leaf?.view instanceof MarkdownView ? leaf.view : null;
  }

  private promptFile(files: TFile[]): Promise<string | null> {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'relay-view-modal';
      const box = document.createElement('div');
      box.className = 'relay-view-modal-box';
      box.createEl('div', { cls: 'relay-view-modal-title', text: '选择目标笔记' });

      const input = document.createElement('input');
      input.className = 'relay-view-modal-input';
      input.placeholder = '输入笔记名或路径...';
      box.appendChild(input);

      const list = document.createElement('div');
      list.className = 'relay-view-modal-list';
      box.appendChild(list);

      const render = () => {
        list.empty();
        const query = input.value.toLowerCase();
        files
          .filter((file) => file.path.toLowerCase().includes(query) || file.basename.toLowerCase().includes(query))
          .slice(0, 12)
          .forEach((file) => {
            const btn = document.createElement('button');
            btn.textContent = file.path;
            btn.onclick = () => { resolve(file.path); modal.remove(); };
            list.appendChild(btn);
          });
      };

      input.addEventListener('input', render);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { resolve(null); modal.remove(); }
        if (event.key === 'Enter') {
          const match = files.find((file) => file.path === input.value || file.basename === input.value);
          resolve(match?.path || null);
          modal.remove();
        }
      });

      const row = box.createDiv({ cls: 'relay-view-modal-actions' });
      row.createEl('button', { text: '取消', cls: 'relay-view-btn' }).onclick = () => { resolve(null); modal.remove(); };
      modal.appendChild(box);
      modal.addEventListener('click', (event) => {
        if (event.target === modal) { resolve(null); modal.remove(); }
      });
      document.body.appendChild(modal);
      input.focus();
      render();
    });
  }

  private formatItem(item: RelayItem) {
    if (item.type === 'image') return `![](${item.content})`;
    if (item.type === 'url') return `[${item.title || item.content}](${item.content})`;
    if (item.type === 'video') {
      const stamp = item.videoTimestamp !== undefined ? ` at ${formatDuration(item.videoTimestamp)}` : '';
      return `[${item.title || item.content}${stamp}](${item.content})`;
    }
    return item.content;
  }

  private persist() {
    this.setItems(this.items);
    this.saveSettings();
    this.renderList();
  }
}

function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
