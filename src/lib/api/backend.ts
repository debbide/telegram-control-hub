/**
 * 后端 API 客户端 - 连接 TG Bot 后端
 */

// 获取后端 API 地址
export function getBackendUrl(): string {
  // 优先使用环境变量
  if (import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL;
  }

  // 开发模式下使用 localhost
  if (import.meta.env.DEV) {
    return 'http://localhost:3001';
  }

  // 生产环境下使用空字符串（同源部署，endpoint 已包含 /api）
  return '';
}

export const BACKEND_URL = getBackendUrl();

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const url = `${BACKEND_URL}${endpoint}`;

    // 自动附加 Authorization header
    const token = localStorage.getItem('bot_admin_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...options.headers,
      },
    });

    const data = await response.json().catch(() => ({}));

    // 直接返回后端的响应格式（后端已包含 success/data/error）
    if (!response.ok) {
      return {
        success: false,
        error: data.error || `HTTP ${response.status}`,
      };
    }

    // 如果后端返回了 success 字段，直接透传
    if ('success' in data) {
      return data;
    }

    // 兼容没有 success 字段的响应
    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error',
    };
  }
}

// ==================== Settings API ====================

export interface BotSettings {
  botToken?: string;
  adminId?: string;
  groupId?: string;
  tgApiBase?: string;
  webPort?: number;
  logLevel?: string;
  autoStart?: boolean;
  notifications?: boolean;
  // AI 配置 (与后端 settings.js 一致的平级字段)
  openaiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  // RSS 全局配置
  rss?: {
    checkInterval?: number;
    customBotToken?: string;
    customChatId?: string;
    messageTemplate?: string;
  };
  github?: {
    checkInterval?: number;
  };
  webdav?: {
    url?: string;
    username?: string;
    password?: string;
    remotePath?: string;
    autoBackup?: boolean;
    autoBackupInterval?: number;
  };
}

export const settingsApi = {
  async get(): Promise<ApiResponse<BotSettings>> {
    return request<BotSettings>('/api/settings');
  },

  async update(settings: Partial<BotSettings>): Promise<ApiResponse<{ success: boolean }>> {
    return request('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings),
    });
  },
};

// ==================== AI Providers API ====================

export interface AIProvider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  isActive: boolean;
}

export const aiProvidersApi = {
  async list(): Promise<ApiResponse<AIProvider[]>> {
    return request<AIProvider[]>('/api/ai-providers');
  },

  async create(provider: Partial<AIProvider>): Promise<ApiResponse<AIProvider>> {
    return request('/api/ai-providers', {
      method: 'POST',
      body: JSON.stringify(provider),
    });
  },

  async update(id: string, updates: Partial<AIProvider>): Promise<ApiResponse<AIProvider>> {
    return request(`/api/ai-providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async delete(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return request(`/api/ai-providers/${id}`, { method: 'DELETE' });
  },

  async activate(id: string): Promise<ApiResponse<{ success: boolean; message: string }>> {
    return request(`/api/ai-providers/${id}/activate`, { method: 'POST' });
  },
};

// ==================== Backup API ====================

export interface WebDAVBackup {
  name: string;
  path: string;
  modified: string | null;
  size: number;
}

export const backupApi = {
  // 下载本地备份
  async downloadLocal(): Promise<void> {
    window.open(`${BACKEND_URL}/api/backup`, '_blank');
  },

  // 测试 WebDAV 连接
  async testWebDAV(): Promise<ApiResponse<{ message: string }>> {
    return request('/api/backup/webdav/test', { method: 'POST' });
  },

  // 备份到 WebDAV
  async uploadToWebDAV(): Promise<ApiResponse<{ message: string; path: string }>> {
    return request('/api/backup/webdav/upload', { method: 'POST' });
  },

  // 列出 WebDAV 备份
  async listWebDAV(): Promise<ApiResponse<WebDAVBackup[]>> {
    return request<WebDAVBackup[]>('/api/backup/webdav/list');
  },

  // 从 WebDAV 恢复
  async restoreFromWebDAV(path: string): Promise<ApiResponse<{ message: string }>> {
    return request('/api/backup/webdav/restore', {
      method: 'POST',
      body: JSON.stringify({ path }),
    });
  },

  // 删除 WebDAV 备份
  async deleteWebDAV(filename: string): Promise<ApiResponse<{ success: boolean }>> {
    return request(`/api/backup/webdav/${filename}`, { method: 'DELETE' });
  },
};

// ==================== Status API ====================

export interface BotStatus {
  running: boolean;
  configured: boolean;
  subscriptions: number;
}

export const statusApi = {
  async get(): Promise<ApiResponse<BotStatus>> {
    return request<BotStatus>('/api/status');
  },

  async restart(): Promise<ApiResponse<{ success: boolean; message: string }>> {
    return request('/api/restart', { method: 'POST' });
  },

  async health(): Promise<ApiResponse<{ status: string; botRunning: boolean; timestamp: string }>> {
    return request('/health');
  },
};

// ==================== Subscriptions API ====================

export interface Subscription {
  id: string;
  url: string;
  title: string;
  interval: number;
  enabled: boolean;
  chatId?: string;
  userId?: string;
  useCustomPush?: boolean;  // 是否使用独立推送配置
  customBotToken?: string;  // 可选：独立 Bot Token
  customChatId?: string;    // 可选：独立推送目标
  keywords?: {
    whitelist: string[];
    blacklist: string[];
  };
  lastCheck?: string;
  lastError?: string;
  createdAt?: string;
}

export const subscriptionsApi = {
  async list(): Promise<ApiResponse<Subscription[]>> {
    return request<Subscription[]>('/api/subscriptions');
  },

  async create(subscription: Partial<Subscription>): Promise<ApiResponse<Subscription>> {
    return request('/api/subscriptions', {
      method: 'POST',
      body: JSON.stringify(subscription),
    });
  },

  async update(id: string, updates: Partial<Subscription>): Promise<ApiResponse<Subscription>> {
    return request(`/api/subscriptions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async delete(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return request(`/api/subscriptions/${id}`, { method: 'DELETE' });
  },

  async refresh(id?: string): Promise<ApiResponse<{ success: boolean }>> {
    const endpoint = id ? `/api/subscriptions/${id}/refresh` : '/api/subscriptions/refresh';
    return request(endpoint, { method: 'POST' });
  },
};

// ==================== RSS Parse API ====================

export interface ParseResult {
  success: boolean;
  title?: string;
  items?: Array<{
    id: string;
    title: string;
    link: string;
    description?: string;
    pubDate: string;
    source?: string;
  }>;
  error?: string;
}

export const rssParseApi = {
  async parse(url: string, keywords?: { whitelist?: string[]; blacklist?: string[] }): Promise<ApiResponse<ParseResult>> {
    return request('/api/rss/parse', {
      method: 'POST',
      body: JSON.stringify({ url, keywords }),
    });
  },

  async validate(url: string): Promise<ApiResponse<{ valid: boolean; title?: string; error?: string }>> {
    return request('/api/rss/validate', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  },
};

// ==================== History API ====================

export interface HistoryItem {
  feedId: string;
  feedTitle: string;
  item: {
    id: string;
    title: string;
    link: string;
    description?: string;
    pubDate: string;
  };
  foundAt: string;
}

export const historyApi = {
  async get(): Promise<ApiResponse<HistoryItem[]>> {
    return request<HistoryItem[]>('/api/subscriptions/history');
  },
};

// ==================== Logs API ====================

export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: string;
  source: string;
}

export const logsApi = {
  async get(limit?: number): Promise<ApiResponse<LogEntry[]>> {
    const query = limit ? `?limit=${limit}` : '';
    return request<LogEntry[]>(`/api/logs${query}`);
  },

  async clear(): Promise<ApiResponse<{ success: boolean }>> {
    return request('/api/logs', { method: 'DELETE' });
  },
};

// ==================== Message API ====================

export const messageApi = {
  async send(chatId: string, text: string): Promise<ApiResponse<{ success: boolean; messageId?: number }>> {
    return request('/api/send', {
      method: 'POST',
      body: JSON.stringify({ chatId, text }),
    });
  },

  async sendToAdmin(text: string): Promise<ApiResponse<{ success: boolean; messageId?: number }>> {
    return request('/api/send/admin', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },
};

// ==================== Stats API ====================

export interface DashboardStats {
  online: boolean;
  uptime: string;
  memory: number;
  lastRestart: string;
  totalCommands: number;
  commandsToday: number;
  aiTokensUsed: number;
  rssFeeds: number;
  pendingReminders: number;
  activeNotes: number;
  commandStats?: Array<{
    command: string;
    label: string;
    count: number;
    icon: string;
  }>;
  commandTrend?: Array<{
    date: string;
    total?: number;
    chat?: number;
    rss?: number;
    tools?: number;
  }>;
  recentActivity?: Array<{
    id: string;
    type: string;
    description: string;
    time: string;
    icon: string;
  }>;
}

export const statsApi = {
  async get(): Promise<ApiResponse<DashboardStats>> {
    return request<DashboardStats>('/api/stats');
  },
};

// ==================== Notes API ====================

export interface Note {
  id: string;
  content: string;
  createdAt: string;
  completed: boolean;
}

export const notesApi = {
  async list(): Promise<ApiResponse<Note[]>> {
    return request<Note[]>('/api/notes');
  },

  async create(content: string): Promise<ApiResponse<Note>> {
    return request('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

  async update(id: string, updates: Partial<Note>): Promise<ApiResponse<Note>> {
    return request(`/api/notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async delete(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return request(`/api/notes/${id}`, { method: 'DELETE' });
  },
};

// ==================== Reminders API ====================

export interface Reminder {
  id: string;
  content: string;
  triggerAt: string;
  repeat?: 'once' | 'daily' | 'weekly';
  status: 'pending' | 'triggered' | 'cancelled';
}

export const remindersApi = {
  async list(): Promise<ApiResponse<Reminder[]>> {
    return request<Reminder[]>('/api/reminders');
  },

  async create(reminder: Partial<Reminder>): Promise<ApiResponse<Reminder>> {
    return request('/api/reminders', {
      method: 'POST',
      body: JSON.stringify(reminder),
    });
  },

  async update(id: string, updates: Partial<Reminder>): Promise<ApiResponse<Reminder>> {
    return request(`/api/reminders/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async delete(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return request(`/api/reminders/${id}`, { method: 'DELETE' });
  },
};

// ==================== Notifications API ====================

export interface Notification {
  id: string;
  type: 'reminder' | 'rss' | 'system' | 'error';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export const notificationsApi = {
  async list(): Promise<ApiResponse<Notification[]>> {
    return request<Notification[]>('/api/notifications');
  },

  async markAsRead(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return request(`/api/notifications/${id}/read`, { method: 'POST' });
  },

  async markAllRead(): Promise<ApiResponse<{ success: boolean }>> {
    return request('/api/notifications/read-all', { method: 'POST' });
  },

  async delete(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return request(`/api/notifications/${id}`, { method: 'DELETE' });
  },

  async clear(): Promise<ApiResponse<{ success: boolean }>> {
    return request('/api/notifications', { method: 'DELETE' });
  },

  async sendTest(): Promise<ApiResponse<{ success: boolean }>> {
    return request('/api/notifications/test', { method: 'POST' });
  },
};

// ==================== Tools API ====================

export interface Tool {
  id: string;
  command: string;
  label: string;
  description: string;
  emoji: string;
  enabled: boolean;
  usage: number;
}

export const toolsApi = {
  async list(): Promise<ApiResponse<Tool[]>> {
    return request<Tool[]>('/api/tools');
  },

  async toggle(id: string, enabled: boolean): Promise<ApiResponse<Tool>> {
    return request(`/api/tools/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  },

  async getStats(): Promise<ApiResponse<Array<{ command: string; count: number }>>> {
    return request('/api/tools/stats');
  },
};

// ==================== Auth API ====================

export interface AuthUser {
  username: string;
  isAdmin: boolean;
}

export const authApi = {
  async login(username: string, password: string): Promise<ApiResponse<{ token: string; user: AuthUser }>> {
    return request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  async logout(): Promise<ApiResponse<{ success: boolean }>> {
    return request('/api/auth/logout', { method: 'POST' });
  },

  async verify(): Promise<ApiResponse<{ valid: boolean; user?: AuthUser }>> {
    return request('/api/auth/verify');
  },

  async changePassword(oldPassword: string, newPassword: string): Promise<ApiResponse<{ success: boolean }>> {
    return request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  },
};

// ==================== Scheduled Tasks API ====================

export interface ScheduledTask {
  id: string;
  type: 'rss' | 'system' | 'backup';
  name: string;
  description: string;
  interval: string;
  lastRun: string | null;
  nextRun: string | null;
  status: 'active' | 'paused' | 'running' | 'error';
  error: string | null;
  lastDurationMs?: number | null;
  lastSuccessAt?: string | null;
  lastErrorAt?: string | null;
  runCount?: number;
  successCount?: number;
  failureCount?: number;
}

export const scheduledTasksApi = {
  async list(): Promise<ApiResponse<ScheduledTask[]>> {
    return request<ScheduledTask[]>('/api/scheduled-tasks');
  },
};

// ==================== Trending API ====================

export interface TrendingSource {
  id: string;
  name: string;
  emoji: string;
  color: string;
  enabled: boolean;
}

export interface TrendingItem {
  rank: number;
  title: string;
  hot: string | number;
  url: string;
  tag: string;
}

export interface TrendingData {
  id: string;
  name: string;
  emoji: string;
  color: string;
  items: TrendingItem[];
  updatedAt: string;
}

export const trendingApi = {
  async getSources(): Promise<ApiResponse<TrendingSource[]>> {
    return request<TrendingSource[]>('/api/trending/sources');
  },

  async getAll(): Promise<ApiResponse<Record<string, TrendingData>>> {
    return request<Record<string, TrendingData>>('/api/trending');
  },

  async getBySource(source: string): Promise<ApiResponse<TrendingData>> {
    return request<TrendingData>(`/api/trending/${source}`);
  },

  async push(source: string, limit: number = 10): Promise<ApiResponse<{ message: string }>> {
    return request(`/api/trending/${source}/push`, {
      method: 'POST',
      body: JSON.stringify({ limit }),
    });
  },
};

// ==================== Price Monitor API ====================

export interface PriceMonitorItem {
  id: string;
  name: string;
  url: string;
  selector: string;
  interval: number;
  enabled: boolean;
  notifyOnAnyChange: boolean;
  notifyOnDrop: boolean;
  dropThreshold: number;
  targetPrice: number | null;
  currentPrice: number | null;
  lastPrice: number | null;
  lastCheck: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface PriceHistory {
  price: number;
  timestamp: string;
}

export const priceMonitorApi = {
  async list(): Promise<ApiResponse<PriceMonitorItem[]>> {
    return request<PriceMonitorItem[]>('/api/price-monitors');
  },

  async get(id: string): Promise<ApiResponse<PriceMonitorItem>> {
    return request<PriceMonitorItem>(`/api/price-monitors/${id}`);
  },

  async getHistory(id: string): Promise<ApiResponse<PriceHistory[]>> {
    return request<PriceHistory[]>(`/api/price-monitors/${id}/history`);
  },

  async create(item: Partial<PriceMonitorItem>): Promise<ApiResponse<PriceMonitorItem>> {
    return request('/api/price-monitors', {
      method: 'POST',
      body: JSON.stringify(item),
    });
  },

  async update(id: string, updates: Partial<PriceMonitorItem>): Promise<ApiResponse<PriceMonitorItem>> {
    return request(`/api/price-monitors/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async delete(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return request(`/api/price-monitors/${id}`, { method: 'DELETE' });
  },

  async refresh(id: string): Promise<ApiResponse<PriceMonitorItem>> {
    return request(`/api/price-monitors/${id}/refresh`, { method: 'POST' });
  },

  async test(url: string, selector: string): Promise<ApiResponse<{ price: number }>> {
    return request('/api/price-monitors/test', {
      method: 'POST',
      body: JSON.stringify({ url, selector }),
    });
  },
};

// ==================== GitHub Monitor API ====================

export interface GitHubRepo {
  id: string;
  owner: string;
  repo: string;
  fullName: string;
  watchTypes: string[];
  lastRelease: {
    tag: string;
    publishedAt: string;
  } | null;
  lastStar: number | null;
  lastCheck: string | null;
  createdAt: string;
}

export interface GitHubNotification {
  id: string;
  repoFullName: string;
  type: 'release' | 'star_milestone' | 'owner_repo_update';
  data: {
    tag?: string;
    name?: string;
    body?: string;
    url?: string;
    publishedAt?: string;
    milestone?: number;
    currentStars?: number;
    owner?: string;
    ownerType?: 'user' | 'org';
    updatedCount?: number;
    repos?: Array<{
      fullName: string;
      pushedAt: string;
      htmlUrl: string;
    }>;
    profileUrl?: string;
  };
  createdAt: string;
}

export interface GitHubOwnerMonitor {
  id: string;
  owner: string;
  ownerType: 'user' | 'org';
  repoSnapshots: Array<{
    fullName: string;
    pushedAt: string;
    htmlUrl: string;
  }>;
  lastCheck: string | null;
  createdAt: string;
}

export interface GitHubRepoInfo {
  fullName: string;
  full_name?: string;
  description: string;
  stars: number;
  stargazers_count?: number;
  forks: number;
  forks_count?: number;
  watchers: number;
  watchers_count?: number;
  language: string;
  url: string;
  html_url?: string;
  latestRelease?: {
    tag: string;
    tag_name?: string;
    name: string;
    publishedAt: string;
    published_at?: string;
    url: string;
    html_url?: string;
  };
}

export const githubApi = {
  async list(): Promise<ApiResponse<GitHubRepo[]>> {
    return request<GitHubRepo[]>('/api/github/repos');
  },

  async get(id: string): Promise<ApiResponse<GitHubRepo>> {
    return request<GitHubRepo>(`/api/github/repos/${id}`);
  },

  async create(owner: string, repo: string, watchTypes: string[] = ['release']): Promise<ApiResponse<GitHubRepo>> {
    return request('/api/github/repos', {
      method: 'POST',
      body: JSON.stringify({ repo: `${owner}/${repo}`, watchTypes }),
    });
  },

  async update(id: string, updates: Partial<GitHubRepo>): Promise<ApiResponse<GitHubRepo>> {
    return request(`/api/github/repos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async delete(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return request(`/api/github/repos/${id}`, { method: 'DELETE' });
  },

  async refresh(id: string): Promise<ApiResponse<GitHubRepo>> {
    return request(`/api/github/repos/${id}/refresh`, { method: 'POST' });
  },

  async refreshAll(): Promise<ApiResponse<{ message: string }>> {
    return request('/api/github/refresh-all', { method: 'POST' });
  },

  async getNotifications(): Promise<ApiResponse<GitHubNotification[]>> {
    return request<GitHubNotification[]>('/api/github/notifications');
  },

  async search(owner: string, repo: string): Promise<ApiResponse<GitHubRepoInfo>> {
    return request<GitHubRepoInfo>(`/api/github/search?repo=${owner}/${repo}`);
  },

  async listOwners(): Promise<ApiResponse<GitHubOwnerMonitor[]>> {
    return request<GitHubOwnerMonitor[]>('/api/github/accounts');
  },

  async createOwner(owner: string, ownerType: 'auto' | 'user' | 'org' = 'auto'): Promise<ApiResponse<GitHubOwnerMonitor>> {
    return request('/api/github/accounts', {
      method: 'POST',
      body: JSON.stringify({ owner, ownerType }),
    });
  },

  async deleteOwner(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return request(`/api/github/accounts/${id}`, { method: 'DELETE' });
  },

  async refreshOwner(id: string): Promise<ApiResponse<GitHubOwnerMonitor>> {
    return request(`/api/github/accounts/${id}/refresh`, { method: 'POST' });
  },
};

// ==================== Stickers API ====================

export interface Sticker {
  id: string;
  fileId: string;
  fileUniqueId: string;
  setName: string | null;
  emoji: string | null;
  isAnimated: boolean;
  isVideo: boolean;
  type: string;
  width: number;
  height: number;
  userId: string;
  tags: string[];
  groupId: string | null;
  usageCount: number;
  lastUsed?: string;
  createdAt: string;
}

export interface StickerGroup {
  id: string;
  name: string;
  userId: string;
  order: number;
  count?: number;
  createdAt: string;
}

export const stickersApi = {
  async list(): Promise<ApiResponse<Sticker[]>> {
    return request<Sticker[]>('/api/stickers');
  },

  async get(id: string): Promise<ApiResponse<Sticker>> {
    return request<Sticker>(`/api/stickers/${id}`);
  },

  async update(id: string, updates: { tags?: string[]; groupId?: string | null }): Promise<ApiResponse<Sticker>> {
    return request(`/api/stickers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  },

  async delete(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return request(`/api/stickers/${id}`, { method: 'DELETE' });
  },

  async getGroups(): Promise<ApiResponse<StickerGroup[]>> {
    return request<StickerGroup[]>('/api/stickers/groups');
  },

  async createGroup(name: string): Promise<ApiResponse<StickerGroup>> {
    return request('/api/stickers/groups', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  async updateGroup(id: string, name: string): Promise<ApiResponse<StickerGroup>> {
    return request(`/api/stickers/groups/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
  },

  async deleteGroup(id: string): Promise<ApiResponse<{ success: boolean }>> {
    return request(`/api/stickers/groups/${id}`, { method: 'DELETE' });
  },

  // 导出贴纸为 ZIP
  exportUrl(): string {
    const token = localStorage.getItem('bot_admin_token');
    return `${BACKEND_URL}/api/stickers/export?token=${token}`;
  },

  // 导入贴纸（创建贴纸包）
  async import(
    files: File[],
    title: string,
    emojis: string = '😀',
    options?: { packMode?: 'new' | 'existing'; packName?: string }
  ): Promise<ApiResponse<{
    mode: 'new' | 'existing';
    packName: string;
    packTitle: string;
    stickerCount: number;
    totalUploaded: number;
    errors?: string[];
    link: string;
  }>> {
    const formData = new FormData();
    files.forEach(file => formData.append('stickers', file));
    formData.append('title', title);
    formData.append('emojis', emojis);
    if (options?.packMode) {
      formData.append('packMode', options.packMode);
    }
    if (options?.packName) {
      formData.append('packName', options.packName);
    }

    const token = localStorage.getItem('bot_admin_token');
    const url = `${BACKEND_URL}/api/stickers/import`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return { success: false, error: data.error || `HTTP ${response.status}` };
      }

      return data;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Network error' };
    }
  },
};

// ==================== Sticker Packs API ====================

export interface StickerPack {
  id: string;
  userId: string;
  name: string;
  title: string;
  stickerType?: 'static' | 'animated' | 'video';
  stickerCount: number;
  createdAt: string;
}

export const stickerPacksApi = {
  // 获取贴纸包列表
  async list(): Promise<ApiResponse<StickerPack[]>> {
    return request('/api/sticker-packs');
  },

  // 获取贴纸包内容（从 Telegram 获取）
  async getStickers(packName: string): Promise<ApiResponse<{
    name: string;
    title: string;
    stickerType: string;
    isAnimated: boolean;
    isVideo: boolean;
    stickers: Array<{
      fileId: string;
      emoji: string;
      isAnimated: boolean;
      isVideo: boolean;
      width: number;
      height: number;
      fileUrl?: string;
      error?: string;
    }>;
  }>> {
    return request(`/api/sticker-packs/${encodeURIComponent(packName)}/stickers`);
  },

  exportPackUrl(packName: string): string {
    const token = localStorage.getItem('bot_admin_token');
    const url = `${BACKEND_URL}/api/sticker-packs/${encodeURIComponent(packName)}/export`;
    return token ? `${url}?token=${encodeURIComponent(token)}` : url;
  },


  // 删除贴纸包（仅本地记录）
  async delete(packName: string): Promise<ApiResponse<{ success: boolean }>> {
    return request(`/api/sticker-packs/${encodeURIComponent(packName)}`, { method: 'DELETE' });
  },
};

// ==================== WebSocket URL ====================

export function getWebSocketUrl(): string {
  const backendUrl = getBackendUrl();
  const token = localStorage.getItem('bot_admin_token');
  const query = token ? `?token=${encodeURIComponent(token)}` : '';

  if (!backendUrl) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws${query}`;
  }

  return `${backendUrl.replace(/^http/, 'ws')}/ws${query}`;
}

export default {
  settings: settingsApi,
  status: statusApi,
  subscriptions: subscriptionsApi,
  rssParse: rssParseApi,
  history: historyApi,
  logs: logsApi,
  message: messageApi,
  stats: statsApi,
  notes: notesApi,
  reminders: remindersApi,
  notifications: notificationsApi,
  tools: toolsApi,
  auth: authApi,
  scheduledTasks: scheduledTasksApi,
  trending: trendingApi,
  priceMonitor: priceMonitorApi,
  github: githubApi,
  stickers: stickersApi,
};
