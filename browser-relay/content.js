// ═══════════════════════════════════════════════════════════
// Obsidian 中转站 — Content Script (可拖拽 + 风格统一)
// ═══════════════════════════════════════════════════════════

(() => {
  'use strict';

  if (window.__obsidianRelayInjected) return;
  window.__obsidianRelayInjected = true;

  const DEFAULT_RIGHT = 24;
  const DEFAULT_BOTTOM = 24;
  const PANEL_WIDTH = 360;
  const PANEL_HEIGHT = 520;

  function init() {
    if (!document.body) { setTimeout(init, 100); return; }

    // ── Shadow DOM 宿主 ──
    const host = document.createElement('div');
    host.id = '__obsidian-relay-host';
    host.style.cssText = [
      'position:fixed',
      'right:' + DEFAULT_RIGHT + 'px',
      'bottom:' + DEFAULT_BOTTOM + 'px',
      'z-index:2147483647',
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
    ].join(';');
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'closed' });

    // ── 样式 ──
    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      .relay-fab { display:flex;align-items:center;gap:6px;min-width:96px;height:38px;padding:0 14px;border:0;border-radius:19px;background:#7C3AED;color:#fff;box-shadow:0 6px 18px rgba(124,58,237,.35);cursor:default;font-size:13px;font-weight:700;line-height:1;user-select:none;white-space:nowrap; }
      .relay-fab:hover { background:#6D28D9; }
      .relay-fab.open { background:#F59E0B;box-shadow:0 6px 18px rgba(245,158,11,.35); }
      .relay-fab:not(.pinned) { cursor:grab; }
      .relay-fab:not(.pinned):active { cursor:grabbing; }
      .fab-icon { width:18px;height:18px;border-radius:50%;background:rgba(255,255,255,.2);display:inline-flex;align-items:center;justify-content:center;font-size:11px; }
      .badge { min-width:16px;height:16px;border-radius:8px;padding:0 4px;display:inline-flex;align-items:center;justify-content:center;background:#ef4444;color:#fff;font-size:10px;line-height:1; }
      .badge:empty { display:none; }
      .relay-panel { position:fixed;width:${PANEL_WIDTH}px;max-width:calc(100vw - 16px);max-height:${PANEL_HEIGHT}px;background:#1e1e2e;color:#cdd6f4;border:1px solid rgba(255,255,255,.1);border-radius:12px;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35);display:flex;flex-direction:column;opacity:0;transform:scale(.95);pointer-events:none;transition:opacity .2s,transform .2s; }
      .relay-panel.show { opacity:1;transform:scale(1);pointer-events:auto; }
      .relay-header { height:46px;padding:8px 10px 8px 14px;background:#181825;border-bottom:1px solid #313244;display:flex;align-items:center;justify-content:space-between;gap:8px; }
      .relay-title { font-size:14px;font-weight:700; }
      .relay-actions { display:flex;align-items:center;gap:4px; }
      .relay-tool { min-width:30px;height:28px;padding:0 8px;border:0;border-radius:6px;background:transparent;color:#a6adc8;cursor:pointer;font-size:12px;font-family:inherit; }
      .relay-tool:hover { background:#313244;color:#cdd6f4; }
      .relay-batch-bar { display:none;align-items:center;gap:6px;padding:7px 10px;background:#313244;border-bottom:1px solid #45475a; }
      .relay-list { flex:1;min-height:120px;max-height:380px;overflow-y:auto;padding:8px; }
      .relay-list::-webkit-scrollbar { width:4px; }
      .relay-list::-webkit-scrollbar-thumb { background:#45475a;border-radius:2px; }
      .relay-empty { padding:36px 16px;color:#6c7086;text-align:center;font-size:13px;line-height:1.7; }
      .relay-item { background:#313244;border:1px solid transparent;border-radius:8px;padding:10px;margin-bottom:6px; }
      .relay-item:hover { border-color:rgba(255,255,255,.12); }
      .relay-item.starred { border-left:3px solid #fbbf24; }
      .relay-item-row { display:flex;align-items:flex-start;gap:8px; }
      .relay-item-main { flex:1;min-width:0; }
      .relay-item-type { color:#a6adc8;font-size:11px;margin-bottom:5px; }
      .relay-item-content { color:#cdd6f4;font-size:13px;line-height:1.45;max-height:76px;overflow:hidden;overflow-wrap:anywhere;white-space:pre-wrap; }
      .relay-item-content.expanded { max-height:none; }
      .relay-item-url { color:#89b4fa;display:block;font-size:12px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
      .relay-item-url:hover { text-decoration:underline; }
      .relay-item-img { max-width:100%;max-height:120px;border-radius:6px;display:block;object-fit:cover;cursor:pointer; }
      .relay-item-actions { display:flex;justify-content:flex-end;gap:4px;margin-top:8px;opacity:0;transition:opacity .15s; }
      .relay-item:hover .relay-item-actions { opacity:1; }
      .relay-item-btn { height:24px;min-width:26px;padding:0 6px;border:0;border-radius:5px;background:rgba(255,255,255,.06);color:#a6adc8;cursor:pointer;font-size:11px;font-family:inherit; }
      .relay-item-btn:hover { background:rgba(255,255,255,.14);color:#cdd6f4; }
      .relay-item-btn.danger:hover { background:#45273a;color:#f38ba8; }
      .relay-edit-area { width:100%;min-height:72px;margin-top:8px;border:1px solid #45475a;border-radius:6px;background:#1e1e2e;color:#cdd6f4;padding:8px;resize:vertical;font:inherit;font-size:13px;line-height:1.45; }
      .relay-edit-area:focus { outline:none;border-color:#89b4fa; }
      .relay-footer { display:flex;align-items:center;gap:8px;padding:10px;background:#181825;border-top:1px solid #313244; }
      .relay-input { flex:1;min-width:0;height:34px;border:1px solid #45475a;border-radius:8px;background:#313244;color:#cdd6f4;padding:0 10px;outline:none;font:inherit;font-size:13px; }
      .relay-input:focus { border-color:#89b4fa; }
      .relay-input::placeholder { color:#6c7086; }
      .relay-send { width:34px;height:34px;border:0;border-radius:8px;background:#7C3AED;color:#fff;cursor:pointer;font-size:18px;line-height:1; }
      .relay-send:hover { background:#6D28D9; }
      .relay-toast { position:fixed;right:24px;bottom:80px;z-index:2147483647;background:#a6e3a1;color:#1e1e2e;border-radius:8px;padding:8px 12px;font-size:12px;font-weight:700;animation:relay-fade 2s ease forwards; }
      @keyframes relay-fade { 0%,75%{opacity:1;transform:translateY(0)} 100%{opacity:0;transform:translateY(4px)} }
    `;
    shadow.appendChild(style);

    // ── DOM 结构 ──
    const fab = document.createElement('button');
    fab.className = 'relay-fab';
    fab.type = 'button';
    fab.title = 'Obsidian 中转站';
    fab.innerHTML = '<span class="fab-icon">📋</span><span>中转站</span><span class="badge"></span>';
    shadow.appendChild(fab);

    const panel = document.createElement('div');
    panel.className = 'relay-panel';
    panel.innerHTML = [
      '<div class="relay-header">',
      '<div class="relay-title">📋 中转站</div>',
      '<div class="relay-actions">',
      '<button class="relay-tool relay-select-btn" id="selectBtn" type="button" title="多选模式">☑️ 多选</button>',
      '<button class="relay-tool" id="clipPage" type="button" title="剪藏">📎</button>',
      '<button class="relay-tool" id="smartClip" type="button" title="智能提取">🧠</button>',
      '<button class="relay-tool" id="syncBtn" type="button" title="同步">🔄</button>',
      '<button class="relay-tool" id="closeBtn" type="button" title="关闭">✕</button>',
      '</div>',
      '</div>',
      '<div class="relay-batch-bar" id="batchBar">',
      '<button class="relay-tool" id="batchStar" type="button">⭐ 收藏</button>',
      '<button class="relay-tool" id="batchDelete" type="button">🗑️ 删除</button>',
      '<button class="relay-tool" id="batchExport" type="button">📥 导出</button>',
      '<button class="relay-tool" id="selectAll" type="button">✅ 全选</button>',
      '</div>',
      '<div class="relay-list" id="itemList"></div>',
      '<div class="relay-footer">',
      '<input class="relay-input" id="quickInput" placeholder="输入文字或链接..." />',
      '<button class="relay-send" id="sendBtn" type="button">+</button>',
      '</div>',
    ].join('');
    shadow.appendChild(panel);

    // ── 状态 ──
    let items = [];
    let editingId = null;
    let isDragging = false;
    let dragStarted = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;
    let mouseStartX = 0;
    let mouseStartY = 0;
    let fabX = 0;
    let fabY = 0;
    let isPinned = true;
    let fabVisible = true;
    let selectMode = false;
    let selectedIds = new Set();

    restoreState();
    bindEvents();
    loadItems();

    // ── 恢复位置和状态 ──
    function restoreState() {
      try {
        chrome.storage.local.get(['relayFabX', 'relayFabY', 'relayPinned'], (data) => {
          if (chrome.runtime.lastError) {
            updatePinnedStyle();
            return;
          }
          isPinned = data.relayPinned !== false;
          if (Number.isFinite(data.relayFabX) && Number.isFinite(data.relayFabY)) {
            fabX = data.relayFabX;
            fabY = data.relayFabY;
            applyPosition();
          }
          updatePinnedStyle();
        });
      } catch (error) {
        updatePinnedStyle();
      }
    }

    // ── 事件绑定 ──
    function bindEvents() {
      fab.addEventListener('mousedown', startDrag);
      fab.addEventListener('click', togglePanel);

      shadow.getElementById('closeBtn').addEventListener('click', closePanel);
      shadow.getElementById('clipPage').addEventListener('click', clipPage);
      shadow.getElementById('smartClip').addEventListener('click', smartClip);
      shadow.getElementById('syncBtn').addEventListener('click', syncAndLoad);
      shadow.getElementById('sendBtn').addEventListener('click', sendQuick);
      shadow.getElementById('quickInput').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') sendQuick();
      });

      shadow.getElementById('selectBtn').addEventListener('click', toggleSelectMode);
      shadow.getElementById('selectAll').addEventListener('click', toggleSelectAll);
      shadow.getElementById('batchStar').addEventListener('click', batchStar);
      shadow.getElementById('batchDelete').addEventListener('click', batchDelete);
      shadow.getElementById('batchExport').addEventListener('click', batchExport);

      window.addEventListener('resize', () => {
        if (panel.classList.contains('show')) positionPanel();
      });

      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'ITEMS_UPDATED') {
          items = Array.isArray(message.items) ? message.items : [];
          if (panel.classList.contains('show')) renderItems();
          updateBadge();
        } else if (message.type === 'TOGGLE_PANEL') {
          togglePanel();
        } else if (message.type === 'SHOW_FAB') {
          host.style.display = '';
          fabVisible = true;
          sendResponse({ ok: true, visible: true, pinned: isPinned });
        } else if (message.type === 'HIDE_FAB') {
          host.style.display = 'none';
          fabVisible = false;
          closePanel();
          sendResponse({ ok: true, visible: false, pinned: isPinned });
        } else if (message.type === 'SET_PINNED') {
          isPinned = message.pinned !== false;
          updatePinnedStyle();
          try { chrome.storage.local.set({ relayPinned: isPinned }); } catch (e) {}
          sendResponse({ ok: true, visible: fabVisible, pinned: isPinned });
        } else if (message.type === 'GET_FAB_STATE') {
          sendResponse({ visible: fabVisible, pinned: isPinned });
        } else if (message.type === 'GRAB_PAGE_CONTENT') {
          sendResponse({ content: grabPageContent() });
        }
        return true;
      });
    }

    // ── 拖拽 ──
    function startDrag(event) {
      if (isPinned) return;
      event.preventDefault();
      mouseStartX = event.clientX;
      mouseStartY = event.clientY;
      dragStarted = false;

      const rect = host.getBoundingClientRect();
      dragOffsetX = event.clientX - rect.left;
      dragOffsetY = event.clientY - rect.top;

      const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - mouseStartX;
        const dy = moveEvent.clientY - mouseStartY;
        if (!dragStarted && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
          dragStarted = true;
          isDragging = true;
        }
        if (!dragStarted) return;

        fabX = clamp(moveEvent.clientX - dragOffsetX, 0, window.innerWidth - host.offsetWidth);
        fabY = clamp(moveEvent.clientY - dragOffsetY, 0, window.innerHeight - host.offsetHeight);
        applyPosition();
        if (panel.classList.contains('show')) positionPanel();
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (dragStarted) {
          try { chrome.storage.local.set({ relayFabX: fabX, relayFabY: fabY }); } catch (e) {}
        }
        setTimeout(() => { isDragging = false; }, 0);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function applyPosition() {
      host.style.left = fabX + 'px';
      host.style.top = fabY + 'px';
      host.style.right = 'auto';
      host.style.bottom = 'auto';
    }

    function updatePinnedStyle() {
      fab.classList.toggle('pinned', isPinned);
    }

    // ── 面板显隐 ──
    function togglePanel() {
      if (isDragging) return;
      const isOpen = panel.classList.toggle('show');
      fab.classList.toggle('open', isOpen);
      if (isOpen) {
        positionPanel();
        syncAndLoad();
      }
    }

    function closePanel() {
      panel.classList.remove('show');
      fab.classList.remove('open');
    }

    function positionPanel() {
      const rect = host.getBoundingClientRect();
      const margin = 8;
      let left = rect.left - PANEL_WIDTH - margin;
      let top = rect.top - PANEL_HEIGHT + rect.height;

      if (left < margin) left = rect.right + margin;
      if (left + PANEL_WIDTH > window.innerWidth - margin) left = window.innerWidth - PANEL_WIDTH - margin;
      if (top < margin) top = margin;
      if (top + PANEL_HEIGHT > window.innerHeight - margin) top = window.innerHeight - PANEL_HEIGHT - margin;

      panel.style.left = Math.max(margin, left) + 'px';
      panel.style.top = Math.max(margin, top) + 'px';
    }

    // ── 数据操作 ──
    function loadItems() {
      chrome.runtime.sendMessage({ type: 'GET_ITEMS' }, (response) => {
        if (chrome.runtime.lastError) return;
        items = Array.isArray(response?.items) ? response.items : [];
        renderItems();
        updateBadge();
      });
    }

    function syncAndLoad() {
      chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, (response) => {
        if (chrome.runtime.lastError) {
          loadItems();
          return;
        }
        items = Array.isArray(response?.items) ? response.items : items;
        renderItems();
        updateBadge();
      });
    }

    function updateBadge() {
      const badge = shadow.querySelector('.badge');
      if (!badge) return;
      badge.textContent = items.length ? (items.length > 99 ? '99+' : String(items.length)) : '';
    }

    // ── 渲染 ──
    function renderItems() {
      const list = shadow.getElementById('itemList');
      const batchBar = shadow.getElementById('batchBar');
      batchBar.style.display = selectMode ? 'flex' : 'none';

      if (!items.length) {
        list.innerHTML = '<div class="relay-empty">📭 暂无内容<br><small>右键网页 → 发送到中转站</small></div>';
        return;
      }

      // 收藏排前面
      const sorted = [...items].sort((a, b) => Number(Boolean(b.starred)) - Number(Boolean(a.starred)));
      list.innerHTML = sorted.map(renderItem).join('');

      // 使用 currentTarget 而非 target，避免点到按钮内部的 emoji 子节点时取不到 dataset
      list.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', (event) => {
          const target = event.currentTarget;
          handleAction(target.dataset.action, target.dataset.id);
        });
      });
      list.querySelectorAll('.relay-item-cb').forEach((checkbox) => {
        checkbox.addEventListener('change', (event) => {
          const target = event.currentTarget;
          if (target.checked) selectedIds.add(target.dataset.id);
          else selectedIds.delete(target.dataset.id);
        });
      });
      list.querySelectorAll('.relay-item-img').forEach((image) => {
        image.addEventListener('click', () => {
          image.style.maxHeight = image.style.maxHeight === 'none' ? '120px' : 'none';
        });
      });
      // 内容展开/收起
      list.querySelectorAll('.relay-item-content').forEach((contentDiv) => {
        contentDiv.addEventListener('click', () => {
          contentDiv.classList.toggle('expanded');
        });
      });
    }

    function renderItem(item) {
      const time = new Date(item.createdAt || Date.now()).toLocaleString('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
      const type = item.type || 'text';
      const typeLabel = { text:'📝', image:'🖼️', url:'🔗', clip:'📎' }[type] || '📄';
      const checked = selectedIds.has(item.id) ? ' checked' : '';
      const checkbox = selectMode
        ? '<input class="relay-item-cb" type="checkbox" data-id="' + esc(item.id) + '"' + checked + ' />'
        : '';
      let contentHtml = '';

      if (type === 'image') {
        contentHtml = '<img class="relay-item-img" src="' + esc(item.content) + '" alt="" />';
      } else if (type === 'url') {
        const title = item.title || item.content;
        const href = safeUrl(item.content);
        contentHtml = [
          '<div class="relay-item-content">' + esc(title) + '</div>',
          href ? '<a class="relay-item-url" href="' + esc(href) + '" target="_blank" rel="noreferrer noopener">' + esc(item.content) + '</a>'
               : '<div class="relay-item-content" style="color:#f38ba8">⚠️ 不安全链接: ' + esc(item.content) + '</div>',
        ].join('');
      } else {
        contentHtml = '<div class="relay-item-content">' + esc(item.content) + '</div>';
      }

      const canEdit = type === 'text' || type === 'clip';
      const editHtml = editingId === item.id
        ? [
            '<textarea class="relay-edit-area" id="editArea-' + esc(item.id) + '">' + esc(item.content) + '</textarea>',
            '<div class="relay-item-actions" style="opacity:1">',
            '<button class="relay-item-btn" type="button" data-action="save" data-id="' + esc(item.id) + '">✅ 保存</button>',
            '<button class="relay-item-btn" type="button" data-action="cancel" data-id="' + esc(item.id) + '">↩️ 取消</button>',
            '</div>',
          ].join('')
        : '';

      return [
        '<div class="relay-item' + (item.starred ? ' starred' : '') + '" data-id="' + esc(item.id) + '">',
        '<div class="relay-item-row">',
        checkbox,
        '<div class="relay-item-main">',
        '<div class="relay-item-type">' + typeLabel + ' · ' + esc(time) + '</div>',
        contentHtml,
        '<div class="relay-item-actions">',
        '<button class="relay-item-btn" type="button" data-action="star" data-id="' + esc(item.id) + '">' + (item.starred ? '⭐' : '☆') + '</button>',
        canEdit ? '<button class="relay-item-btn" type="button" data-action="edit" data-id="' + esc(item.id) + '">✏️</button>' : '',
        '<button class="relay-item-btn" type="button" data-action="copy" data-id="' + esc(item.id) + '">📋</button>',
        '<button class="relay-item-btn danger" type="button" data-action="delete" data-id="' + esc(item.id) + '">🗑️</button>',
        '</div>',
        editHtml,
        '</div>',
        '</div>',
        '</div>',
      ].join('');
    }

    function handleAction(action, id) {
      if (!action || !id) return;
      if (action === 'edit') {
        editingId = id;
        renderItems();
        const editArea = shadow.getElementById('editArea-' + id);
        if (editArea) editArea.focus();
      } else if (action === 'save') {
        const area = shadow.getElementById('editArea-' + id);
        if (!area) return;
        chrome.runtime.sendMessage({ type: 'UPDATE_ITEM', id: id, updates: { content: area.value } }, () => {
          if (chrome.runtime.lastError) return;
          editingId = null;
          loadItems();
          toast('已保存');
        });
      } else if (action === 'cancel') {
        editingId = null;
        renderItems();
      } else if (action === 'copy') {
        const item = items.find((entry) => entry.id === id);
        if (item) copyText(item.content).then(() => toast('已复制'));
      } else if (action === 'delete') {
        chrome.runtime.sendMessage({ type: 'DELETE_ITEM', id: id }, () => {
          if (chrome.runtime.lastError) return;
          loadItems();
          toast('已删除');
        });
      } else if (action === 'star') {
        chrome.runtime.sendMessage({ type: 'TOGGLE_STAR', id: id }, () => {
          if (chrome.runtime.lastError) return;
          loadItems();
        });
      }
    }

    // ── 快捷输入 ──
    function sendQuick() {
      const input = shadow.getElementById('quickInput');
      const text = input.value.trim();
      if (!text) return;
      const item = /^https?:\/\//i.test(text)
        ? { type: 'url', content: text, title: text }
        : { type: 'text', content: text };
      chrome.runtime.sendMessage({ type: 'ADD_ITEM', item: item }, () => {
        if (chrome.runtime.lastError) return;
        input.value = '';
        loadItems();
        toast('已添加');
      });
    }

    // ── 剪藏 ──
    function clipPage() {
      chrome.runtime.sendMessage({ type: 'CLIP_PAGE' }, () => {
        if (chrome.runtime.lastError) return;
        loadItems();
        toast('页面已剪藏');
      });
    }

    // ── 智能提取 ──
    function smartClip() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        toast('请先选中内容');
        return;
      }
      const range = selection.getRangeAt(0);
      const container = document.createElement('div');
      container.appendChild(range.cloneContents());
      chrome.runtime.sendMessage(
        { type: 'SMART_EXTRACT', html: container.innerHTML, text: selection.toString() },
        (response) => {
          if (chrome.runtime.lastError || !response?.content) return;
          chrome.runtime.sendMessage(
            {
              type: 'ADD_ITEM',
              item: {
                type: response.type || 'text',
                content: response.content,
                url: location.href,
                title: document.title,
              },
            },
            () => {
              if (chrome.runtime.lastError) return;
              loadItems();
              toast('智能提取完成');
            }
          );
        }
      );
    }

    // ── 批量操作 ──
    function toggleSelectMode() {
      selectMode = !selectMode;
      selectedIds.clear();
      renderItems();
    }

    function toggleSelectAll() {
      if (selectedIds.size === items.length) selectedIds.clear();
      else items.forEach((item) => selectedIds.add(item.id));
      renderItems();
    }

    function batchStar() {
      const ids = [...selectedIds];
      ids.forEach((id) => chrome.runtime.sendMessage({ type: 'TOGGLE_STAR', id: id }));
      selectedIds.clear();
      selectMode = false;
      setTimeout(loadItems, 250);
      toast('已收藏');
    }

    function batchDelete() {
      if (!selectedIds.size) return;
      chrome.runtime.sendMessage({ type: 'BATCH_DELETE', ids: [...selectedIds] }, () => {
        if (chrome.runtime.lastError) return;
        selectedIds.clear();
        selectMode = false;
        loadItems();
        toast('已删除');
      });
    }

    function batchExport() {
      chrome.runtime.sendMessage({ type: 'EXPORT_ITEMS', ids: [...selectedIds] }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.content) copyText(response.content).then(() => toast('已复制到剪贴板'));
      });
    }

    // ── 页面内容抓取 ──
    function grabPageContent() {
      const title = document.title || location.href;
      const url = location.href;
      const article = document.querySelector('article') || document.querySelector('main') || document.body;
      const lines = ['# ' + title, '', '> 来源: [' + title + '](' + url + ')', ''];

      walkContent(article, lines);
      return lines.join('\n').replace(/\n{3,}/g, '\n\n').slice(0, 50000);
    }

    function walkContent(root, lines) {
      root.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.replace(/\s+/g, ' ').trim();
          if (text) lines.push(text);
          return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const el = node;
        if (el.matches('script, style, noscript, svg, canvas, iframe')) return;

        const tag = el.tagName.toLowerCase();
        const text = el.textContent.replace(/\s+/g, ' ').trim();

        if (tag === 'h1') lines.push('', '# ' + text, '');
        else if (tag === 'h2') lines.push('', '## ' + text, '');
        else if (tag === 'h3') lines.push('', '### ' + text, '');
        else if (tag === 'p') lines.push(text, '');
        else if (tag === 'blockquote') lines.push('> ' + text, '');
        else if (tag === 'pre' || tag === 'code') lines.push('```', el.textContent.trim(), '```', '');
        else if (tag === 'img') {
          let src = el.getAttribute('src') || '';
          if (src && !/^https?:\/\//i.test(src)) src = new URL(src, location.origin).href;
          const alt = el.getAttribute('alt') || '';
          if (src) lines.push('![' + alt + '](' + src + ')', '');
        } else if (tag === 'a') {
          const href = el.getAttribute('href') || '';
          if (href && text) {
            const fullHref = /^https?:\/\//i.test(href) ? href : new URL(href, location.origin).href;
            lines.push('[' + text + '](' + fullHref + ')');
          }
        } else if (tag === 'li') {
          lines.push('- ' + text);
        } else if (['ul', 'ol'].includes(tag)) {
          el.querySelectorAll('li').forEach((li, i) => {
            const liText = li.textContent.replace(/\s+/g, ' ').trim();
            lines.push(tag === 'ul' ? '- ' + liText : (i + 1) + '. ' + liText);
          });
        } else {
          walkContent(el, lines);
        }
      });
    }

    // ── 工具函数 ──
    function copyText(text) {
      if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
      // Fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      return Promise.resolve();
    }

    function toast(message) {
      const node = document.createElement('div');
      node.className = 'relay-toast';
      node.textContent = message;
      document.body.appendChild(node);
      setTimeout(() => node.remove(), 2000);
    }

    function esc(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // 清理 URL，阻止 javascript: / data: / vbscript: 等危险协议
    function safeUrl(url) {
      var str = String(url || '').trim();
      if (!str) return '';
      // 仅允许 http: 和 https:（以及相对路径、根路径、协议相对 URL）
      if (/^(https?:)?\/\//i.test(str)) return str;
      if (/^[a-z][a-z0-9+\-.]*:/i.test(str)) return ''; // 拦截所有其他协议（javascript:, data:, vbscript: 等）
      return str; // 相对路径或片段
    }

    function clamp(value, min, max) {
      return Math.max(min, Math.min(value, max));
    }
  }

  init();
})();
