export type RelayItemType = 'text' | 'image' | 'url' | 'clip' | 'video';

export interface RelayItem {
  id: string;
  type: RelayItemType;
  content: string;
  title?: string;
  url?: string;
  sourceUrl?: string;
  targetPath?: string;
  summary?: string;
  tags?: string[];
  starred?: boolean;
  videoTimestamp?: number;
  videoDuration?: number;
  createdAt: number;
  updatedAt: number;
}

export interface RelayTarget {
  type: 'file' | 'folder';
  path: string;
  name: string;
}

export interface RelaySummaryResult {
  summary: string;
  tags: string[];
}

export interface RelayStore {
  items: RelayItem[];
}

export const RELAY_PORT = 51234;
export const RELAY_STORE_KEY = 'relayItems';
export const RELAY_MAX_CONTENT_LENGTH = 50000;
