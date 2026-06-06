import {
  RELAY_MAX_CONTENT_LENGTH,
  RELAY_PORT,
  RelayItem,
  RelaySummaryResult,
  RelayTarget,
} from './relay-types';

type RelayEventHandler = (event: string, data: unknown) => void;
type HttpRequest = any;
type HttpResponse = any;

interface RelayServerActions {
  listTargets?: () => RelayTarget[];
  appendToTarget?: (itemId: string, targetPath: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  createNoteFromItem?: (itemId: string, targetPath: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
  summarizeItem?: (itemId: string) => Promise<{ ok: boolean; item?: RelayItem; result?: RelaySummaryResult; error?: string }>;
}

export class RelayServer {
  private server: any = null;
  private handler: RelayEventHandler | null = null;
  private actions: RelayServerActions;

  constructor(
    private getItems: () => RelayItem[],
    private setItems: (items: RelayItem[]) => void,
    actions: RelayServerActions = {}
  ) {
    this.actions = actions;
  }

  onEvent(handler: RelayEventHandler) {
    this.handler = handler;
  }

  start() {
    if (this.server) return;

    try {
      const http = require('http');
      this.server = http.createServer((req: HttpRequest, res: HttpResponse) => {
        this.handleRequest(req, res).catch((error) => {
          this.writeJson(res, 500, { error: error?.message || String(error) });
        });
      });

      this.server.listen(RELAY_PORT, '127.0.0.1', () => {
        console.log(`[Relay] HTTP server running at http://127.0.0.1:${RELAY_PORT}`);
      });

      this.server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          console.warn(`[Relay] Port ${RELAY_PORT} is already in use.`);
        } else {
          console.error('[Relay] HTTP server error:', error);
        }
      });
    } catch (error) {
      console.error('[Relay] Unable to start HTTP server:', error);
    }
  }

  stop() {
    if (!this.server) return;
    this.server.close();
    this.server = null;
    console.log('[Relay] HTTP server stopped');
  }

  private async handleRequest(req: HttpRequest, res: HttpResponse) {
    this.setCorsHeaders(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!this.isLocalRequest(req)) {
      this.writeJson(res, 403, { error: 'Local requests only' });
      return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${RELAY_PORT}`);
    const path = url.pathname;

    if (req.method === 'GET' && path === '/api/items') {
      this.writeJson(res, 200, { items: this.getItems().map((item) => normalizeItem(item)).filter(Boolean) });
      return;
    }

    if (req.method === 'POST' && path === '/api/items') {
      const body = await this.readBody(req);
      const item = normalizeItem(JSON.parse(body), true);
      if (!item) {
        this.writeJson(res, 400, { error: 'Invalid item' });
        return;
      }

      const items = this.getItems().map((entry) => normalizeItem(entry)).filter(Boolean) as RelayItem[];
      const index = items.findIndex((entry) => entry.id === item.id);
      if (index >= 0) items[index] = { ...items[index], ...item, updatedAt: Date.now() };
      else items.unshift(item);
      this.setItems(items);
      this.writeJson(res, 200, { ok: true, item });
      this.handler?.('add', item);
      return;
    }

    const itemRoute = path.match(/^\/api\/items\/([^/]+)$/);
    if (req.method === 'PUT' && itemRoute) {
      const id = decodeURIComponent(itemRoute[1]);
      const updates = normalizeUpdates(JSON.parse(await this.readBody(req)));
      const items = this.getItems().map((entry) => normalizeItem(entry)).filter(Boolean) as RelayItem[];
      const index = items.findIndex((entry) => entry.id === id);
      if (index === -1) {
        this.writeJson(res, 404, { error: 'Item not found' });
        return;
      }

      items[index] = { ...items[index], ...updates, updatedAt: Date.now() };
      this.setItems(items);
      this.writeJson(res, 200, { ok: true, item: items[index] });
      this.handler?.('update', items[index]);
      return;
    }

    if (req.method === 'DELETE' && itemRoute) {
      const id = decodeURIComponent(itemRoute[1]);
      const items = this.getItems().filter((entry) => entry.id !== id);
      this.setItems(items);
      this.writeJson(res, 200, { ok: true });
      this.handler?.('delete', { id });
      return;
    }

    if (req.method === 'GET' && path === '/api/targets') {
      this.writeJson(res, 200, { targets: this.actions.listTargets?.() || [] });
      return;
    }

    const appendRoute = path.match(/^\/api\/items\/([^/]+)\/append$/);
    if (req.method === 'POST' && appendRoute) {
      const { targetPath } = JSON.parse(await this.readBody(req));
      if (!this.actions.appendToTarget || typeof targetPath !== 'string') {
        this.writeJson(res, 400, { error: 'Missing targetPath' });
        return;
      }
      const result = await this.actions.appendToTarget(decodeURIComponent(appendRoute[1]), targetPath);
      this.writeJson(res, result.ok ? 200 : 400, result);
      return;
    }

    const createRoute = path.match(/^\/api\/items\/([^/]+)\/create-note$/);
    if (req.method === 'POST' && createRoute) {
      const { targetPath } = JSON.parse(await this.readBody(req));
      if (!this.actions.createNoteFromItem || typeof targetPath !== 'string') {
        this.writeJson(res, 400, { error: 'Missing targetPath' });
        return;
      }
      const result = await this.actions.createNoteFromItem(decodeURIComponent(createRoute[1]), targetPath);
      this.writeJson(res, result.ok ? 200 : 400, result);
      return;
    }

    const summaryRoute = path.match(/^\/api\/items\/([^/]+)\/summary$/);
    if (req.method === 'POST' && summaryRoute) {
      if (!this.actions.summarizeItem) {
        this.writeJson(res, 400, { error: 'AI summary is not available' });
        return;
      }
      const result = await this.actions.summarizeItem(decodeURIComponent(summaryRoute[1]));
      this.writeJson(res, result.ok ? 200 : 400, result);
      if (result.item) this.handler?.('summary', result.item);
      return;
    }

    this.writeJson(res, 404, { error: 'Not found' });
  }

  private setCorsHeaders(req: HttpRequest, res: HttpResponse) {
    const origin = String(req.headers?.origin || '');
    const allowed = origin === 'chrome-extension://'
      || origin.startsWith('chrome-extension://')
      || origin === `http://127.0.0.1:${RELAY_PORT}`
      || origin === `http://localhost:${RELAY_PORT}`;
    res.setHeader('Access-Control-Allow-Origin', allowed ? origin || '*' : `http://127.0.0.1:${RELAY_PORT}`);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  private isLocalRequest(req: HttpRequest) {
    const addr = req.socket?.remoteAddress || '';
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  }

  private readBody(req: HttpRequest): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
        if (body.length > RELAY_MAX_CONTENT_LENGTH + 10000) {
          reject(new Error('Request body too large'));
          req.destroy();
        }
      });
      req.on('end', () => resolve(body || '{}'));
      req.on('error', reject);
    });
  }

  private writeJson(res: HttpResponse, status: number, data: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  }
}

function normalizeItem(value: any, createMissingId = false): RelayItem | null {
  if (!value || typeof value !== 'object') return null;
  const content = cleanString(value.content, RELAY_MAX_CONTENT_LENGTH);
  if (!content) return null;

  const now = Date.now();
  const id = cleanString(value.id, 120) || (createMissingId ? createId() : '');
  if (!id) return null;

  const type = ['text', 'image', 'url', 'clip', 'video'].includes(value.type) ? value.type : 'text';
  return {
    id,
    type,
    content,
    title: cleanString(value.title, 500),
    url: cleanString(value.url, 2048),
    sourceUrl: cleanString(value.sourceUrl || value.url, 2048),
    targetPath: cleanString(value.targetPath, 2048),
    summary: cleanString(value.summary, 4000),
    tags: Array.isArray(value.tags) ? value.tags.map((tag: unknown) => cleanString(tag, 80)).filter(Boolean).slice(0, 8) : [],
    starred: Boolean(value.starred),
    videoTimestamp: toOptionalNumber(value.videoTimestamp),
    videoDuration: toOptionalNumber(value.videoDuration),
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : now,
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : now,
  };
}

function normalizeUpdates(value: any): Partial<RelayItem> {
  const updates: Partial<RelayItem> = {};
  if (!value || typeof value !== 'object') return updates;
  if (['text', 'image', 'url', 'clip', 'video'].includes(value.type)) updates.type = value.type;
  if ('content' in value) updates.content = cleanString(value.content, RELAY_MAX_CONTENT_LENGTH);
  if ('title' in value) updates.title = cleanString(value.title, 500);
  if ('url' in value) updates.url = cleanString(value.url, 2048);
  if ('sourceUrl' in value) updates.sourceUrl = cleanString(value.sourceUrl, 2048);
  if ('targetPath' in value) updates.targetPath = cleanString(value.targetPath, 2048);
  if ('summary' in value) updates.summary = cleanString(value.summary, 4000);
  if ('tags' in value && Array.isArray(value.tags)) updates.tags = value.tags.map((tag: unknown) => cleanString(tag, 80)).filter(Boolean).slice(0, 8);
  if ('starred' in value) updates.starred = Boolean(value.starred);
  if ('videoTimestamp' in value) updates.videoTimestamp = toOptionalNumber(value.videoTimestamp);
  if ('videoDuration' in value) updates.videoDuration = toOptionalNumber(value.videoDuration);
  return updates;
}

function cleanString(value: unknown, maxLength: number) {
  return String(value || '').replace(/\u0000/g, '').slice(0, maxLength);
}

function toOptionalNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function createId() {
  return `relay_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
