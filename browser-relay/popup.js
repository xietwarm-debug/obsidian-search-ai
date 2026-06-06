// ═══════════════════════════════════════════════════════════
// Obsidian 中转站 — Popup Script
// ═══════════════════════════════════════════════════════════

let items = [];

// ── 加载数据 ──
function loadItems() {
  chrome.runtime.sendMessage({ type: 'GET_ITEMS' }, (resp) => {
    if (resp?.items) { items = resp.items; render(); }
  });
}

// ── 渲染列表 ──
function render() {
  const list = document.getElementById('itemList');
  document.getElementById('stats').textContent = `共 ${items.length} 条`;

  if (!items.length) {
    list.innerHTML = '<div class="empty">暂无内容<br><small>右键网页 → 发送到中转站</small></div>';
    return;
  }

  list.innerHTML = items.map(item => {
    const typeLabel = { text: '📝', image: '🖼️', url: '🔗', clip: '📎' }[item.type] || '📄';
    const timeStr = new Date(item.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

    let contentHtml = '';
    if (item.type === 'image') {
      contentHtml = `<img class="item-img" src="${esc(item.content)}" />`;
    } else if (item.type === 'url') {
      const href = safeUrl(item.content);
      contentHtml = `<div class="item-content">${esc(item.title || item.content)}</div>
                     ${href ? `<a class="item-url" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(item.content)}</a>`
                            : `<div class="item-content" style="color:#f38ba8">⚠️ 不安全链接: ${esc(item.content)}</div>`}`;
    } else {
      contentHtml = `<div class="item-content">${esc(item.content)}</div>`;
    }

    return `
      <div class="item">
        <div class="item-type">${typeLabel} · ${timeStr}</div>
        ${contentHtml}
        <div class="item-actions">
          ${item.type === 'text' || item.type === 'clip' ? `<button class="item-btn" data-action="copy" data-id="${item.id}" title="复制">📋</button>` : ''}
          <button class="item-btn danger" data-action="delete" data-id="${item.id}" title="删除">🗑️</button>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const { action, id } = e.currentTarget.dataset;
      if (action === 'copy') {
        const item = items.find(i => i.id === id);
        if (item) navigator.clipboard.writeText(item.content).then(() => toast('已复制'));
      } else if (action === 'delete') {
        chrome.runtime.sendMessage({ type: 'DELETE_ITEM', id }, () => { loadItems(); toast('已删除'); });
      }
    });
  });
}

// ── 快速添加 ──
const quickInput = document.getElementById('quickInput');
const sendBtn = document.getElementById('sendBtn');
function sendQuick() {
  const text = quickInput.value.trim();
  if (!text) return;
  const isUrl = /^https?:\/\//.test(text);
  chrome.runtime.sendMessage({ type: 'ADD_ITEM', item: isUrl ? { type: 'url', content: text, title: text } : { type: 'text', content: text } }, () => { quickInput.value = ''; loadItems(); toast('已添加'); });
}
sendBtn.addEventListener('click', sendQuick);
quickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendQuick(); });

// ── 剪藏 ──
document.getElementById('clipPage').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CLIP_PAGE' }, () => { loadItems(); toast('页面已剪藏'); });
});

// ── 悬浮球开关 ──
const toggleFab = document.getElementById('toggleFab');
const togglePinned = document.getElementById('togglePinned');

// 获取当前状态（带超时）
const fabStateTimeout = setTimeout(() => {
  toggleFab.checked = true;
  togglePinned.checked = true;
}, 1000);

chrome.runtime.sendMessage({ type: 'GET_FAB_STATE' }, (resp) => {
  clearTimeout(fabStateTimeout);
  if (resp) {
    toggleFab.checked = resp.visible !== false;
    togglePinned.checked = resp.pinned !== false;
    togglePinned.disabled = !toggleFab.checked;
  }
});

toggleFab.addEventListener('change', () => {
  const visible = toggleFab.checked;
  chrome.runtime.sendMessage({ type: visible ? 'SHOW_FAB' : 'HIDE_FAB' });
  togglePinned.disabled = !visible;
  toast(visible ? '悬浮球已显示' : '悬浮球已隐藏');
});

togglePinned.addEventListener('change', () => {
  const pinned = togglePinned.checked;
  chrome.runtime.sendMessage({ type: 'SET_PINNED', pinned });
  toast(pinned ? '已固定位置' : '可拖拽模式');
});

// ── 自动清理设置 ──
const retentionDays = document.getElementById('retentionDays');
chrome.runtime.sendMessage({ type: 'GET_RETENTION' }, (resp) => {
  if (resp?.days !== undefined) retentionDays.value = String(resp.days);
});
retentionDays.addEventListener('change', () => {
  const days = parseInt(retentionDays.value);
  chrome.runtime.sendMessage({ type: 'SET_RETENTION', days });
  toast(days > 0 ? `自动清理: ${days} 天` : '已关闭自动清理');
});

// ── 监听更新 ──
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ITEMS_UPDATED') { items = msg.items; render(); }
});

// ── 工具 ──
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function safeUrl(url) {
  var str = String(url || '').trim();
  if (!str) return '';
  if (/^(https?:)?\/\//i.test(str)) return str;
  if (/^[a-z][a-z0-9+\-.]*:/i.test(str)) return '';
  return str;
}
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1500);
}

loadItems();
