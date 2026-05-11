import { supabase } from '@/integrations/supabase/client';

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  description: string;
  pubDate: string;
  author?: string;
  categories?: string[];
  content?: string;
  source?: string;
}

export interface ParsedFeed {
  title: string;
  description: string;
  link: string;
  language?: string;
  lastBuildDate?: string;
  items: FeedItem[];
}

export interface RSSParseResponse {
  success: boolean;
  error?: string;
  data?: ParsedFeed;
}

export interface Keywords {
  whitelist: string[];
  blacklist: string[];
}

export interface Subscription {
  id: string;
  url: string;
  title: string;
  interval: number;
  keywords?: Keywords;
  enabled: boolean;
  createdAt: string;
  lastCheck: string | null;
  lastError: string | null;
}

export interface NewItemHistory {
  feedId: string;
  feedTitle: string;
  item: FeedItem;
  foundAt: string;
}

// Check if running in self-hosted mode (Docker)
const isSelfHosted = () => {
  const hostname = window.location.hostname;
  return !hostname.includes('lovableproject.com') && !hostname.includes('localhost');
};

// Self-hosted API implementation
const selfHostedApi = {
  async parse(url: string, keywords?: Keywords): Promise<RSSParseResponse> {
    try {
      const response = await fetch('/api/rss/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, keywords }),
      });
      return await response.json();
    } catch (error) {
      console.error('RSS API error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to parse RSS feed' };
    }
  },

  async validate(url: string): Promise<{ valid: boolean; title?: string; error?: string }> {
    try {
      const response = await fetch('/api/rss/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      return await response.json();
    } catch (error) {
      return { valid: false, error: error instanceof Error ? error.message : 'Validation failed' };
    }
  },

  // 订阅管理 API
  async getSubscriptions(): Promise<{ success: boolean; data?: Subscription[]; error?: string }> {
    try {
      const response = await fetch('/api/subscriptions');
      return await response.json();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get subscriptions' };
    }
  },

  async addSubscription(subscription: Partial<Subscription>): Promise<{ success: boolean; data?: Subscription; error?: string }> {
    try {
      const response = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription),
      });
      return await response.json();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to add subscription' };
    }
  },

  async updateSubscription(id: string, updates: Partial<Subscription>): Promise<{ success: boolean; data?: Subscription; error?: string }> {
    try {
      const response = await fetch(`/api/subscriptions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      return await response.json();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to update subscription' };
    }
  },

  async deleteSubscription(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`/api/subscriptions/${id}`, { method: 'DELETE' });
      return await response.json();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to delete subscription' };
    }
  },

  async refreshAll(): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch('/api/subscriptions/refresh', { method: 'POST' });
      return await response.json();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to refresh subscriptions' };
    }
  },

  async refreshSubscription(id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`/api/subscriptions/${id}/refresh`, { method: 'POST' });
      return await response.json();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to refresh subscription' };
    }
  },

  async getHistory(): Promise<{ success: boolean; data?: NewItemHistory[]; error?: string }> {
    try {
      const response = await fetch('/api/subscriptions/history');
      return await response.json();
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to get history' };
    }
  },
};

// Cloud API implementation (Supabase Edge Functions)
const cloudApi = {
  async parse(url: string, keywords?: Keywords): Promise<RSSParseResponse> {
    // 如果 supabase 未配置，直接返回错误
    if (!supabase) {
      return { success: false, error: 'Supabase not configured' };
    }
    try {
      const { data, error } = await supabase.functions.invoke('rss-parser', {
        body: { url, keywords },
      });
      if (error) {
        console.error('RSS parse error:', error);
        return { success: false, error: error.message };
      }
      return data;
    } catch (error) {
      console.error('RSS API error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Failed to parse RSS feed' };
    }
  },

  async validate(url: string): Promise<{ valid: boolean; title?: string; error?: string }> {
    const result = await this.parse(url);
    if (result.success && result.data) {
      return { valid: true, title: result.data.title };
    }
    return { valid: false, error: result.error };
  },

  // Cloud 模式下暂不支持订阅管理
  async getSubscriptions() { return { success: false, error: 'Not supported in cloud mode' }; },
  async addSubscription() { return { success: false, error: 'Not supported in cloud mode' }; },
  async updateSubscription() { return { success: false, error: 'Not supported in cloud mode' }; },
  async deleteSubscription() { return { success: false, error: 'Not supported in cloud mode' }; },
  async refreshAll() { return { success: false, error: 'Not supported in cloud mode' }; },
  async refreshSubscription() { return { success: false, error: 'Not supported in cloud mode' }; },
  async getHistory() { return { success: false, error: 'Not supported in cloud mode' }; },
};

export const rssApi = {
  async parse(url: string, keywords?: Keywords): Promise<RSSParseResponse> {
    if (isSelfHosted()) {
      return selfHostedApi.parse(url, keywords);
    }
    return cloudApi.parse(url, keywords);
  },

  async validate(url: string): Promise<{ valid: boolean; title?: string; error?: string }> {
    if (isSelfHosted()) {
      return selfHostedApi.validate(url);
    }
    return cloudApi.validate(url);
  },

  async parseMultiple(feeds: Array<{ url: string; keywords?: Keywords }>): Promise<Map<string, RSSParseResponse>> {
    const results = new Map<string, RSSParseResponse>();
    const promises = feeds.map(async ({ url, keywords }) => {
      const result = await this.parse(url, keywords);
      results.set(url, result);
    });
    await Promise.all(promises);
    return results;
  },

  // 订阅管理 API
  getSubscriptions: () => isSelfHosted() ? selfHostedApi.getSubscriptions() : cloudApi.getSubscriptions(),
  addSubscription: (sub: Partial<Subscription>) => isSelfHosted() ? selfHostedApi.addSubscription(sub) : cloudApi.addSubscription(),
  updateSubscription: (id: string, updates: Partial<Subscription>) => isSelfHosted() ? selfHostedApi.updateSubscription(id, updates) : cloudApi.updateSubscription(),
  deleteSubscription: (id: string) => isSelfHosted() ? selfHostedApi.deleteSubscription(id) : cloudApi.deleteSubscription(),
  refreshAll: () => isSelfHosted() ? selfHostedApi.refreshAll() : cloudApi.refreshAll(),
  refreshSubscription: (id: string) => isSelfHosted() ? selfHostedApi.refreshSubscription(id) : cloudApi.refreshSubscription(),
  getHistory: () => isSelfHosted() ? selfHostedApi.getHistory() : cloudApi.getHistory(),

  // 检查是否为自托管模式
  isSelfHosted,
};
