const API_BASE = 'http://127.0.0.1:51234/api';
const SYNC_ALARM = 'obsidian-relay-sync';
const CLEANUP_ALARM = 'obsidian-relay-cleanup';
const MAX_ITEM_CONTENT = 50000;
const ALLOWED_TYPES = new Set(['text', 'image', 'url', 'clip']);

async function getItems() {
  const { relayItems = [] } = await chrome.storage.local.get('relayItems');
  return Array.isArray(relayItems) ? relayItems.map(normalizeItem).filter(Boolean) : [];
}

async function setItems(items) {
  await chrome.storage.local.set({ relayItems: items.map(normalizeItem).filter(Boolean) });
}

async function apiRequest(method, path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    };
    if (body !== undefined) options.body = JSON.stringify(body);

    const response = await fetch(API_BASE + path, options);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } catch (error) {
    console.warn('[Relay] API request failed:', error.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function syncFromObsidian() {
  const result = await apiRequest('GET', '/items');
  if (!Array.isArray(result?.items)) return false;

  const items = result.items.map(normalizeItem).filter(Boolean);
  await setItems(items);
  broadcastToTabs({ type: 'ITEMS_UPDATED', items });
  return true;
}

async function broadcastToTabs(message) {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id && isSupportedTabUrl(tab.url))
      .map((tab) => chrome.tabs.sendMessage(tab.id, message))
  );
}

async function addItem(item) {
  const clean = normalizeItem(item, true);
  const items = await getItems();
  const existing = items.findIndex((entry) => entry.id === clean.id);

  if (existing >= 0) items[existing] = { ...items[existing], ...clean, updatedAt: Date.now() };
  else items.unshift(clean);

  await setItems(items);
  await apiRequest('POST', '/items', clean);
  broadcastToTabs({ type: 'ITEMS_UPDATED', items });
  return clean;
}

async function updateItem(id, updates) {
  const items = await getItems();
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;

  const cleanUpdates = normalizeUpdates(updates);
  items[index] = { ...items[index], ...cleanUpdates, updatedAt: Date.now() };
  await setItems(items);
  await apiRequest('PUT', '/items/' + encodeURIComponent(id), items[index]);
  broadcastToTabs({ type: 'ITEMS_UPDATED', items });
  return items[index];
}

async function deleteItem(id) {
  const items = (await getItems()).filter((item) => item.id !== id);
  await setItems(items);
  await apiRequest('DELETE', '/items/' + encodeURIComponent(id));
  broadcastToTabs({ type: 'ITEMS_UPDATED', items });
}

async function toggleStar(id) {
  const items = await getItems();
  const item = items.find((entry) => entry.id === id);
  if (!item) return null;

  item.starred = !item.starred;
  item.updatedAt = Date.now();
  await setItems(items);
  await apiRequest('PUT', '/items/' + encodeURIComponent(id), item);
  broadcastToTabs({ type: 'ITEMS_UPDATED', items });
  return item;
}

async function batchDelete(ids) {
  const targetIds = new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []);
  const items = (await getItems()).filter((item) => !targetIds.has(item.id));
  await setItems(items);
  await Promise.allSettled([...targetIds].map((id) => apiRequest('DELETE', '/items/' + encodeURIComponent(id))));
  broadcastToTabs({ type: 'ITEMS_UPDATED', items });
}

async function exportItems(ids) {
  const items = await getItems();
  const targetIds = new Set(Array.isArray(ids) ? ids : []);
  const target = targetIds.size ? items.filter((item) => targetIds.has(item.id)) : items;
  const lines = ['# Obsidian Relay Export', ''];

  for (const item of target) {
    const time = new Date(item.createdAt).toLocaleString();
    lines.push('## ' + item.type + ' - ' + time, '');
    if (item.type === 'image') lines.push('![](' + item.content + ')', '');
    else if (item.type === 'url') lines.push('[' + (item.title || item.content) + '](' + item.content + ')', '');
    else lines.push(item.content, '');
    lines.push('---', '');
  }

  return lines.join('\n');
}

async function autoCleanup() {
  const { relayRetentionDays = 0 } = await chrome.storage.local.get('relayRetentionDays');
  const days = Number(relayRetentionDays) || 0;
  if (days <= 0) return;

  const cutoff = Date.now() - days * 86400000;
  const before = await getItems();
  const after = before.filter((item) => item.starred || item.createdAt > cutoff);
  if (after.length === before.length) return;

  await setItems(after);
  broadcastToTabs({ type: 'ITEMS_UPDATED', items: after });
}

function smartExtract(html, text) {
  const sourceHtml = String(html || '');
  const sourceText = String(text || '').trim();

  if (sourceHtml.includes('<table')) {
    const table = extractTable(sourceHtml);
    if (table) return { type: 'text', content: table };
  }

  if (sourceHtml.includes('<pre') || sourceHtml.includes('<code')) {
    const code = extractCode(sourceHtml);
    if (code) return { type: 'text', content: code };
  }

  return { type: 'text', content: sourceText.slice(0, MAX_ITEM_CONTENT) };
}

function extractTable(html) {
  const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) return null;

  const rows = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(tableMatch[1])) !== null) {
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
      cells.push(stripTags(cellMatch[1]).replace(/\|/g, '\\|').trim());
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) return null;

  const width = Math.max(...rows.map((row) => row.length));
  const normalizeRow = (row) => {
    const padded = [...row];
    while (padded.length < width) padded.push('');
    return '| ' + padded.join(' | ') + ' |';
  };

  return [normalizeRow(rows[0]), '| ' + rows[0].map(() => '---').join(' | ') + ' |', ...rows.slice(1).map(normalizeRow)].join('\n');
}

function extractCode(html) {
  const match = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i) || html.match(/<code[^>]*>([\s\S]*?)<\/code>/i);
  if (!match) return null;
  const lang = (html.match(/class="[^"]*language-([\w-]+)/i) || [])[1] || '';
  const code = stripTags(match[1]).trim();
  if (!code) return null;
  return '```' + lang + '\n' + code + '\n```';
}

async function clipPage(tab) {
  if (!tab?.id) return null;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'GRAB_PAGE_CONTENT' });
    if (response?.content) {
      return addItem({ type: 'clip', title: tab.title, url: tab.url, content: response.content });
    }
  } catch (error) {
    console.warn('[Relay] Content script unavailable, saving page link only:', error.message);
  }

  return addItem({
    type: 'clip',
    title: tab.title,
    url: tab.url,
    content: '# ' + (tab.title || tab.url || 'Untitled') + '\n\n> Source: [' + (tab.title || tab.url || 'link') + '](' + (tab.url || '') + ')\n',
  });
}

function normalizeItem(item, createMissingId = false) {
  if (!item || typeof item !== 'object') return null;

  const type = ALLOWED_TYPES.has(item.type) ? item.type : 'text';
  const content = cleanString(item.content, MAX_ITEM_CONTENT);
  if (!content) return null;

  const now = Date.now();
  const id = typeof item.id === 'string' && item.id ? item.id.slice(0, 120) : createMissingId ? createId() : '';
  if (!id) return null;

  return {
    id,
    type,
    content,
    title: cleanString(item.title, 500),
    url: cleanString(item.url, 2048),
    starred: Boolean(item.starred),
    createdAt: Number.isFinite(item.createdAt) ? item.createdAt : now,
    updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : now,
  };
}

function normalizeUpdates(updates) {
  const clean = {};
  if (!updates || typeof updates !== 'object') return clean;
  if (ALLOWED_TYPES.has(updates.type)) clean.type = updates.type;
  if ('content' in updates) clean.content = cleanString(updates.content, MAX_ITEM_CONTENT);
  if ('title' in updates) clean.title = cleanString(updates.title, 500);
  if ('url' in updates) clean.url = cleanString(updates.url, 2048);
  if ('starred' in updates) clean.starred = Boolean(updates.starred);
  return clean;
}

function cleanString(value, maxLength) {
  return String(value || '').replace(/\u0000/g, '').slice(0, maxLength);
}

function stripTags(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function createId() {
  if (crypto?.randomUUID) return 'relay_' + crypto.randomUUID();
  return 'relay_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
}

function isSupportedTabUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: 'relay-selection', title: 'Send selection to Obsidian Relay', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'relay-image', title: 'Send image to Obsidian Relay', contexts: ['image'] });
  chrome.contextMenus.create({ id: 'relay-clip', title: 'Clip current page to Obsidian Relay', contexts: ['page'] });
  chrome.contextMenus.create({ id: 'relay-link', title: 'Send link to Obsidian Relay', contexts: ['link'] });
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(CLEANUP_ALARM, { periodInMinutes: 60 });
  await syncFromObsidian();
  await autoCleanup();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
  chrome.alarms.create(CLEANUP_ALARM, { periodInMinutes: 60 });
  syncFromObsidian();
  autoCleanup();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) syncFromObsidian();
  if (alarm.name === CLEANUP_ALARM) autoCleanup();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'relay-selection') {
    await addItem({ type: 'text', content: info.selectionText, url: tab?.url, title: tab?.title });
  } else if (info.menuItemId === 'relay-image') {
    await addItem({ type: 'image', content: info.srcUrl, url: tab?.url, title: tab?.title });
  } else if (info.menuItemId === 'relay-clip') {
    await clipPage(tab);
  } else if (info.menuItemId === 'relay-link') {
    await addItem({ type: 'url', content: info.linkUrl, title: info.linkText || info.linkUrl, url: tab?.url });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'GET_ITEMS':
          sendResponse({ items: await getItems() });
          break;
        case 'ADD_ITEM':
          sendResponse({ item: await addItem(message.item) });
          break;
        case 'UPDATE_ITEM':
          sendResponse({ item: await updateItem(message.id, message.updates) });
          break;
        case 'DELETE_ITEM':
          await deleteItem(message.id);
          sendResponse({ ok: true });
          break;
        case 'TOGGLE_STAR':
          sendResponse({ item: await toggleStar(message.id) });
          break;
        case 'BATCH_DELETE':
          await batchDelete(message.ids);
          sendResponse({ ok: true });
          break;
        case 'EXPORT_ITEMS':
          sendResponse({ content: await exportItems(message.ids) });
          break;
        case 'SMART_EXTRACT':
          sendResponse(smartExtract(message.html, message.text));
          break;
        case 'SET_RETENTION':
          await chrome.storage.local.set({ relayRetentionDays: Math.max(0, Number(message.days) || 0) });
          sendResponse({ ok: true });
          break;
        case 'GET_RETENTION': {
          const { relayRetentionDays = 0 } = await chrome.storage.local.get('relayRetentionDays');
          sendResponse({ days: relayRetentionDays });
          break;
        }
        case 'RUN_CLEANUP':
          await autoCleanup();
          sendResponse({ ok: true });
          break;
        case 'CLIP_PAGE': {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          sendResponse({ item: await clipPage(sender.tab || activeTab) });
          break;
        }
        case 'SYNC_NOW':
          await syncFromObsidian();
          sendResponse({ items: await getItems() });
          break;
        case 'SHOW_FAB':
        case 'HIDE_FAB':
        case 'SET_PINNED':
        case 'GET_FAB_STATE':
        case 'TOGGLE_PANEL':
          sendResponse(await forwardToActiveTab(message));
          break;
        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error) {
      sendResponse({ error: error.message || String(error) });
    }
  })();
  return true;
});

async function forwardToActiveTab(message) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !isSupportedTabUrl(tab.url)) {
    if (message.type === 'GET_FAB_STATE') return { visible: true, pinned: true };
    return { ok: false, error: 'Current page does not allow content scripts' };
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (message.type === 'GET_FAB_STATE') return { visible: true, pinned: true };
    return { ok: false, error: error.message };
  }
}

syncFromObsidian();
autoCleanup();
