/**
 * TG 多功能机器人 - 主入口
 * 参考 tgbot 架构 + 优化
 */
const express = require('express');
const cors = require('cors');
const winston = require('winston');
const rateLimit = require('express-rate-limit');
const { Telegraf } = require('telegraf');
const { loadSettings, saveSettings, getDataPath } = require('./settings');
const { loadCommands } = require('./commands/loader');
const RssScheduler = require('./scheduler');
const { parseRssFeed } = require('./rss-parser');
const { closeBrowser, getBrowser } = require('./puppeteer.service');

const storage = require('./storage');
const GitHubMonitor = require('./github-monitor');

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

const app = express();
let currentBot = null;
let scheduler = null;
let githubMonitor = null;

function resolveTrustProxy() {
  const raw = process.env.TRUST_PROXY;

  if (raw === undefined || raw === null || raw === '') {
    return process.env.NODE_ENV === 'production' ? 1 : false;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return raw;
}

const trustProxy = resolveTrustProxy();
app.set('trust proxy', trustProxy);
logger.info(`🌐 Express trust proxy: ${String(trustProxy)}`);

// Middleware
app.use(cors());
app.use(express.json());

// ==================== API 限流配置 ====================

// 通用 API 限流：每个 IP 每分钟最多 100 次请求
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: 100,
  message: { success: false, error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 登录接口限流：每个 IP 每分钟最多 5 次（防暴力破解）
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: 5,
  message: { success: false, error: '登录尝试过于频繁，请 1 分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 应用限流中间件
app.use('/api', apiLimiter);
app.use('/api/auth/login', loginLimiter);

// 静态文件服务（合并部署时使用）
const path = require('path');
const fs = require('fs');
const publicPath = path.join(__dirname, 'public');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
}

// ==================== Web API ====================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    botRunning: !!currentBot,
    timestamp: new Date().toISOString()
  });
});

// 获取设置
app.get('/api/settings', (req, res) => {
  const settings = loadSettings();
  // 隐藏敏感信息
  res.json({
    ...settings,
    botToken: settings.botToken ? '***已配置***' : '',
    openaiKey: settings.openaiKey ? '***已配置***' : '',
  });
});

function mergeSettingsWithSecretProtection(currentSettings, incomingSettings) {
  const merged = { ...currentSettings, ...incomingSettings };
  const maskedValue = '***已配置***';

  const keepIfMaskedOrEmpty = (key) => {
    if (!Object.prototype.hasOwnProperty.call(incomingSettings, key)) return;
    const value = incomingSettings[key];
    if (value === maskedValue || value === '') {
      merged[key] = currentSettings[key] || '';
    }
  };

  keepIfMaskedOrEmpty('botToken');
  keepIfMaskedOrEmpty('openaiKey');

  return merged;
}

// 更新设置
app.post('/api/settings', async (req, res) => {
  try {
    const currentSettings = loadSettings();
    const newSettings = mergeSettingsWithSecretProtection(currentSettings, req.body || {});
    saveSettings(newSettings);

    if (githubMonitor) {
      const appliedMinutes = githubMonitor.updateCheckIntervalFromSettings(newSettings);
      githubMonitor.updateCheckInterval(appliedMinutes);
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 重启 Bot
app.post('/api/restart', async (req, res) => {
  try {
    logger.info('🔄 正在重启 Bot...');

    // 停止当前 Bot
    if (currentBot) {
      scheduler?.stopAll();
      await currentBot.stop('RESTART');
      currentBot = null;
    }

    // 等待一秒再启动
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 重新启动 Bot
    await startBot();

    res.json({ success: true, message: 'Bot 重启成功' });
  } catch (error) {
    logger.error(`❌ Bot 重启失败: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== Auth API ====================

// 默认管理员账号
const DEFAULT_ADMIN = { username: 'admin', password: 'admin' };

// 简单的 token 存储（生产环境应使用 JWT 或 session）
let authTokens = new Map();

// ==================== 认证中间件 ====================

// 不需要认证的公开接口
const publicPaths = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/verify',
  '/api/health',
];

// 不需要认证的公开接口前缀（用于动态路径如 /api/stickers/preview/:fileId）
const publicPathPrefixes = [
  '/api/stickers/preview/',
];

// 认证中间件
function authMiddleware(req, res, next) {
  // 检查是否是公开接口（精确匹配）
  if (publicPaths.includes(req.path)) {
    return next();
  }

  // 检查是否是公开接口（前缀匹配）
  if (publicPathPrefixes.some(prefix => req.path.startsWith(prefix))) {
    return next();
  }

  // 非 /api 路径不需要认证（静态文件等）
  if (!req.path.startsWith('/api')) {
    return next();
  }

  // 从请求头获取 Token
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, error: '未登录，请先登录' });
  }

  const token = authHeader.replace('Bearer ', '');
  const user = authTokens.get(token);

  if (!user) {
    return res.status(401).json({ success: false, error: '登录已过期，请重新登录' });
  }

  // 将用户信息挂载到请求对象
  req.user = user;
  next();
}

// 应用认证中间件到所有路由
app.use(authMiddleware);

// 登录
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const settings = loadSettings();

  // 检查是否匹配配置的账号或默认账号
  const adminUser = settings.webUser || DEFAULT_ADMIN.username;
  const adminPass = settings.webPassword || DEFAULT_ADMIN.password;

  if (username === adminUser && password === adminPass) {
    const token = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    authTokens.set(token, { username, isAdmin: true });
    res.json({
      success: true,
      data: {
        token,
        user: { username, isAdmin: true }
      }
    });
  } else {
    res.status(401).json({ success: false, error: '用户名或密码错误' });
  }
});

// 登出
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    authTokens.delete(token);
  }
  res.json({ success: true });
});

// 验证 token
app.get('/api/auth/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.json({ valid: false });
  }
  const token = authHeader.replace('Bearer ', '');
  const user = authTokens.get(token);
  if (user) {
    res.json({ valid: true, user });
  } else {
    res.json({ valid: false });
  }
});

// Bot 状态
app.get('/api/status', (req, res) => {
  const settings = loadSettings();
  res.json({
    running: !!currentBot,
    configured: !!settings.botToken,
    subscriptions: scheduler?.getSubscriptions()?.length || 0,
  });
});

// ==================== RSS API ====================

app.post('/api/rss/parse', async (req, res) => {
  try {
    const { url, keywords } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }
    const result = await parseRssFeed(url, keywords);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/rss/validate', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ valid: false, error: 'URL is required' });
    }
    const result = await parseRssFeed(url);
    if (result.success) {
      res.json({ valid: true, title: result.title, itemCount: result.items?.length || 0 });
    } else {
      res.json({ valid: false, error: result.error });
    }
  } catch (error) {
    res.json({ valid: false, error: error.message });
  }
});

// 订阅管理 API
app.get('/api/subscriptions', (req, res) => {
  const subscriptions = scheduler?.getSubscriptions() || [];
  res.json({ success: true, data: subscriptions });
});

app.post('/api/subscriptions', async (req, res) => {
  try {
    const { url, title, interval, keywords, enabled, chatId } = req.body;
    const settings = loadSettings();
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }
    const result = await parseRssFeed(url);
    if (!result.success) {
      return res.json({ success: false, error: result.error });
    }
    const subscription = scheduler.addSubscription({
      url,
      title: title || result.title,
      interval: interval || 30,
      keywords,
      enabled: enabled !== false,
      chatId: chatId || settings.adminId, // 默认推送到管理员
    });
    res.json({ success: true, data: subscription });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/subscriptions/:id', (req, res) => {
  const subscription = scheduler.updateSubscription(req.params.id, req.body);
  if (!subscription) {
    return res.status(404).json({ success: false, error: 'Subscription not found' });
  }
  res.json({ success: true, data: subscription });
});

app.delete('/api/subscriptions/:id', (req, res) => {
  const deleted = scheduler.deleteSubscription(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Subscription not found' });
  }
  res.json({ success: true });
});

app.post('/api/subscriptions/refresh', async (req, res) => {
  await scheduler?.refreshAll();
  res.json({ success: true });
});

// Bot Token 测试 API
app.post('/api/bot/test', async (req, res) => {
  try {
    const { botToken, chatId } = req.body;
    const token = botToken || loadSettings().botToken;

    if (!token) {
      return res.status(400).json({ success: false, error: '未提供 Bot Token' });
    }

    const testBot = new Telegraf(token);
    const botInfo = await testBot.telegram.getMe();

    // 如果提供了 chatId，发送测试消息
    if (chatId) {
      await testBot.telegram.sendMessage(chatId, `✅ 测试成功！\n\n🤖 Bot: @${botInfo.username}\n📍 目标: ${chatId}\n⏱ 时间: ${new Date().toLocaleString('zh-CN')}`);
    }

    res.json({
      success: true,
      data: {
        username: botInfo.username,
        firstName: botInfo.first_name,
        messageSent: !!chatId
      }
    });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/subscriptions/:id/refresh', async (req, res) => {
  try {
    await scheduler?.refreshSubscription(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(404).json({ success: false, error: error.message });
  }
});

app.get('/api/subscriptions/history', (req, res) => {
  const history = scheduler?.getNewItemsHistory() || [];
  res.json({ success: true, data: history });
});

// ==================== Message API ====================

app.post('/api/send', async (req, res) => {
  try {
    const { chatId, text } = req.body;
    if (!chatId || !text) {
      return res.status(400).json({ success: false, error: '缺少 chatId 或 text' });
    }
    if (!currentBot) {
      return res.status(503).json({ success: false, error: 'Bot 未连接' });
    }
    const result = await currentBot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' });
    res.json({ success: true, messageId: result.message_id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/send/admin', async (req, res) => {
  try {
    const { text } = req.body;
    const settings = loadSettings();
    if (!text) {
      return res.status(400).json({ success: false, error: '消息内容不能为空' });
    }
    if (!settings.adminId) {
      return res.status(400).json({ success: false, error: '未配置管理员 ID' });
    }
    if (!currentBot) {
      return res.status(503).json({ success: false, error: 'Bot 未连接' });
    }
    const result = await currentBot.telegram.sendMessage(settings.adminId, text, { parse_mode: 'HTML' });
    res.json({ success: true, messageId: result.message_id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== Stats API ====================

app.get('/api/stats', (req, res) => {
  const stats = storage.getStats();
  const reminders = storage.getReminders();
  const notes = storage.getNotes();
  const today = new Date().toISOString().split('T')[0];
  const todayStats = stats.dailyStats?.[today] || { total: 0 };

  // 构建命令统计数组
  const commandStats = Object.entries(stats.commandCounts || {}).map(([cmd, count]) => ({
    command: cmd,
    label: cmd.replace('/', ''),
    count,
    icon: '📊',
  })).sort((a, b) => b.count - a.count).slice(0, 6);

  // 构建最近 7 天趋势
  const commandTrend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayStats = stats.dailyStats?.[dateStr] || { total: 0 };
    commandTrend.push({
      date: `${d.getMonth() + 1}-${d.getDate()}`,
      total: dayStats.total || 0,
    });
  }

  res.json({
    success: true,
    data: {
      online: !!currentBot,
      uptime: process.uptime() > 3600
        ? `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`
        : `${Math.floor(process.uptime() / 60)}m`,
      memory: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100),
      lastRestart: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      totalCommands: stats.totalCommands || 0,
      commandsToday: todayStats.total || 0,
      aiTokensUsed: stats.aiTokensUsed || 0,
      rssFeeds: scheduler?.getSubscriptions()?.length || 0,
      pendingReminders: reminders.filter(r => r.status === 'pending').length,
      activeNotes: notes.filter(n => !n.completed).length,
      commandStats,
      commandTrend,
      recentActivity: [],
    }
  });
});

// ==================== Notifications API ====================

app.get('/api/notifications', (req, res) => {
  res.json({ success: true, data: [] });
});

app.post('/api/notifications/:id/read', (req, res) => {
  res.json({ success: true });
});

app.post('/api/notifications/read-all', (req, res) => {
  res.json({ success: true });
});

app.delete('/api/notifications/:id', (req, res) => {
  res.json({ success: true });
});

app.delete('/api/notifications', (req, res) => {
  res.json({ success: true });
});

app.post('/api/notifications/test', async (req, res) => {
  try {
    const settings = loadSettings();
    if (!settings.adminId || !currentBot) {
      return res.status(400).json({ success: false, error: 'Bot 未连接或未配置管理员 ID' });
    }

    await currentBot.telegram.sendMessage(settings.adminId, '🔔 这是一条来自 Web 面板的测试通知');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== Reminders API ====================

app.get('/api/reminders', (req, res) => {
  const reminders = storage.getReminders();
  res.json({ success: true, data: reminders });
});

app.post('/api/reminders', (req, res) => {
  const { content, triggerAt, repeat } = req.body;
  if (!content || !triggerAt) {
    return res.status(400).json({ success: false, error: '内容和时间不能为空' });
  }

  const settings = loadSettings();
  const userId = settings.adminId ? settings.adminId.toString() : null;
  const chatId = userId; // 默认发给管理员

  const reminder = storage.addReminder(content, triggerAt, repeat, userId, chatId);
  storage.addLog('info', `添加提醒: ${content}`, 'reminder');
  res.json({ success: true, data: reminder });
});

app.delete('/api/reminders/:id', (req, res) => {
  const success = storage.deleteReminder(req.params.id);
  if (success) {
    storage.addLog('info', `删除提醒: ${req.params.id}`, 'reminder');
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: '提醒不存在' });
  }
});

app.put('/api/reminders/:id', (req, res) => {
  const reminder = storage.updateReminder(req.params.id, req.body);
  if (!reminder) {
    return res.status(404).json({ success: false, error: '提醒不存在' });
  }
  storage.addLog('info', `更新提醒: ${req.params.id}`, 'reminder');
  res.json({ success: true, data: reminder });
});

// ... (Logs API omitted) ...

async function checkReminders(bot) {
  const settings = loadSettings();
  if (!settings.features.reminders) return;

  const reminders = storage.getReminders();
  const now = new Date();

  // 兼容 targetTime 和 triggerAt
  const pendingReminders = reminders.filter(r => {
    const time = r.targetTime || r.triggerAt;
    return r.status === 'pending' && new Date(time) <= now;
  });

  for (const reminder of pendingReminders) {
    try {
      // 优先使用 reminder 中的 chatId，如果没有则发给 adminId
      const targetChatId = reminder.chatId || settings.adminId;

      if (targetChatId) {
        const content = reminder.message || reminder.content;
        await bot.telegram.sendMessage(targetChatId, `⏰ <b>提醒</b>\n\n${content}`, { parse_mode: 'HTML' });
        storage.addLog('info', `触发提醒: ${content}`, 'reminder');

        // 更新状态或设置下次提醒
        if (reminder.repeat === 'daily') {
          const time = reminder.targetTime || reminder.triggerAt;
          const nextTime = new Date(time);
          nextTime.setDate(nextTime.getDate() + 1);

          // 更新时同时更新两个字段以保持兼容
          storage.updateReminder(reminder.id, {
            targetTime: nextTime.toISOString(),
            triggerAt: nextTime.toISOString()
          });
        } else {
          storage.updateReminder(reminder.id, { status: 'completed' });
        }
      }
    } catch (e) {
      storage.addLog('error', `提醒发送失败: ${e.message}`, 'reminder');
    }
  }
}

// ==================== Logs API ====================

app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const logs = storage.getLogs().slice(-limit).reverse();
  res.json({ success: true, data: logs });
});

app.delete('/api/logs', (req, res) => {
  storage.clearLogs();
  res.json({ success: true });
});

// ==================== Auth API Extensions ====================

app.post('/api/auth/change-password', (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const settings = loadSettings();
  const currentPassword = settings.webPassword || DEFAULT_ADMIN.password;

  if (oldPassword !== currentPassword) {
    return res.status(401).json({ success: false, error: '旧密码错误' });
  }

  settings.webPassword = newPassword;
  saveSettings(settings);
  res.json({ success: true });
});

// ==================== AI Providers API ====================

// 获取所有 AI 配置
app.get('/api/ai-providers', (req, res) => {
  const settings = loadSettings();
  const providers = (settings.aiProviders || []).map(p => ({
    ...p,
    apiKey: p.apiKey ? '***已配置***' : '', // 隐藏 API Key
    isActive: p.id === settings.activeAiProvider,
  }));
  res.json({ success: true, data: providers });
});

// 添加 AI 配置
app.post('/api/ai-providers', (req, res) => {
  const { name, apiKey, baseUrl, model } = req.body;
  if (!name || !apiKey || !baseUrl) {
    return res.status(400).json({ success: false, error: '名称、API Key 和 Base URL 不能为空' });
  }

  const settings = loadSettings();
  if (!settings.aiProviders) {
    settings.aiProviders = [];
  }

  const newProvider = {
    id: `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name,
    apiKey,
    baseUrl,
    model: model || 'gpt-3.5-turbo',
  };

  settings.aiProviders.push(newProvider);

  // 如果是第一个配置，自动激活
  if (settings.aiProviders.length === 1) {
    settings.activeAiProvider = newProvider.id;
  }

  saveSettings(settings);
  res.json({
    success: true,
    data: {
      ...newProvider,
      apiKey: '***已配置***',
      isActive: newProvider.id === settings.activeAiProvider,
    }
  });
});

// 更新 AI 配置
app.put('/api/ai-providers/:id', (req, res) => {
  const { id } = req.params;
  const { name, apiKey, baseUrl, model } = req.body;

  const settings = loadSettings();
  const index = (settings.aiProviders || []).findIndex(p => p.id === id);

  if (index === -1) {
    return res.status(404).json({ success: false, error: '配置不存在' });
  }

  // 更新字段（只更新提供的字段）
  if (name) settings.aiProviders[index].name = name;
  if (apiKey) settings.aiProviders[index].apiKey = apiKey;
  if (baseUrl) settings.aiProviders[index].baseUrl = baseUrl;
  if (model) settings.aiProviders[index].model = model;

  saveSettings(settings);
  res.json({
    success: true,
    data: {
      ...settings.aiProviders[index],
      apiKey: '***已配置***',
      isActive: settings.aiProviders[index].id === settings.activeAiProvider,
    }
  });
});

// 删除 AI 配置
app.delete('/api/ai-providers/:id', (req, res) => {
  const { id } = req.params;
  const settings = loadSettings();

  const index = (settings.aiProviders || []).findIndex(p => p.id === id);
  if (index === -1) {
    return res.status(404).json({ success: false, error: '配置不存在' });
  }

  // 不能删除当前激活的配置（除非只剩这一个）
  if (id === settings.activeAiProvider && settings.aiProviders.length > 1) {
    return res.status(400).json({ success: false, error: '不能删除当前激活的配置，请先切换到其他配置' });
  }

  settings.aiProviders.splice(index, 1);

  // 如果删除的是激活配置，清除激活状态
  if (id === settings.activeAiProvider) {
    settings.activeAiProvider = settings.aiProviders[0]?.id || null;
  }

  saveSettings(settings);
  res.json({ success: true });
});

// 激活 AI 配置
app.post('/api/ai-providers/:id/activate', (req, res) => {
  const { id } = req.params;
  const settings = loadSettings();

  const provider = (settings.aiProviders || []).find(p => p.id === id);
  if (!provider) {
    return res.status(404).json({ success: false, error: '配置不存在' });
  }

  settings.activeAiProvider = id;
  saveSettings(settings);
  res.json({ success: true, message: `已切换到: ${provider.name}` });
});

// ==================== Tools API ====================

app.get('/api/tools', (req, res) => {
  const tools = storage.getTools();
  res.json({ success: true, data: tools });
});

app.put('/api/tools/:id', (req, res) => {
  const tool = storage.updateTool(req.params.id, req.body);
  if (!tool) {
    return res.status(404).json({ success: false, error: '工具不存在' });
  }
  res.json({ success: true, data: tool });
});

app.post('/api/tools/:id/toggle', (req, res) => {
  const { enabled } = req.body;
  const tool = storage.updateTool(req.params.id, { enabled });
  if (!tool) {
    return res.status(404).json({ success: false, error: '工具不存在' });
  }
  res.json({ success: true, data: tool });
});

app.get('/api/tools/stats', (req, res) => {
  const tools = storage.getTools();
  const stats = tools.map(t => ({ command: t.command, count: t.usage || 0 }));
  res.json({ success: true, data: stats });
});

// ==================== Scheduled Tasks API ====================

app.get('/api/scheduled-tasks', (req, res) => {
  const settings = loadSettings();
  const tasks = [];

  // 1. RSS 订阅检查任务
  const subscriptions = scheduler?.getSubscriptions() || [];
  for (const sub of subscriptions) {
    if (sub.enabled) {
      const lastCheck = sub.lastCheck ? new Date(sub.lastCheck) : null;
      const intervalMs = (sub.interval || 30) * 60 * 1000;
      const nextCheck = lastCheck ? new Date(lastCheck.getTime() + intervalMs) : new Date();

      tasks.push({
        id: `rss_${sub.id}`,
        type: 'rss',
        name: `RSS: ${sub.title}`,
        description: `检查订阅 "${sub.title}"`,
        interval: `${sub.interval} 分钟`,
        lastRun: sub.lastCheck || null,
        nextRun: nextCheck.toISOString(),
        status: sub.lastError ? 'error' : 'active',
        error: sub.lastError || null,
      });
    }
  }

  // 2. 提醒检查任务 (每分钟)
  tasks.push({
    id: 'reminder_check',
    type: 'system',
    name: '提醒检查器',
    description: '检查并发送到期的提醒',
    interval: '1 分钟',
    lastRun: null,
    nextRun: null,
    status: settings.features?.reminders ? 'active' : 'paused',
    error: null,
  });

  // 3. WebDAV 自动备份任务
  const webdavConfig = settings.webdav || {};
  if (webdavConfig.autoBackup && webdavConfig.url) {
    tasks.push({
      id: 'webdav_backup',
      type: 'backup',
      name: 'WebDAV 自动备份',
      description: '备份数据到 WebDAV 服务器',
      interval: `${webdavConfig.autoBackupInterval || 24} 小时`,
      lastRun: null,
      nextRun: null,
      status: 'active',
      error: null,
    });
  }

  res.json({ success: true, data: tasks });
});

// ==================== Trending API ====================

const trending = require('./trending');

// 缓存热榜数据，避免频繁请求
let trendingCache = {};
let trendingCacheTime = null;
const TRENDING_CACHE_TTL = 5 * 60 * 1000; // 5 分钟缓存

// 获取所有热榜源
app.get('/api/trending/sources', (req, res) => {
  res.json({
    success: true,
    data: Object.values(trending.TRENDING_SOURCES),
  });
});

// 获取指定源的热榜
app.get('/api/trending/:source', async (req, res) => {
  const { source } = req.params;

  if (!trending.TRENDING_SOURCES[source]) {
    return res.status(404).json({ success: false, error: '不支持的热榜源' });
  }

  try {
    // 检查缓存
    const now = Date.now();
    if (
      trendingCache[source] &&
      trendingCacheTime &&
      now - trendingCacheTime < TRENDING_CACHE_TTL
    ) {
      return res.json({ success: true, data: trendingCache[source], cached: true });
    }

    const items = await trending.fetchTrending(source);
    trendingCache[source] = {
      ...trending.TRENDING_SOURCES[source],
      items,
      updatedAt: new Date().toISOString(),
    };
    trendingCacheTime = now;

    res.json({ success: true, data: trendingCache[source] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取所有热榜
app.get('/api/trending', async (req, res) => {
  try {
    // 检查缓存
    const now = Date.now();
    if (
      Object.keys(trendingCache).length > 0 &&
      trendingCacheTime &&
      now - trendingCacheTime < TRENDING_CACHE_TTL
    ) {
      return res.json({ success: true, data: trendingCache, cached: true });
    }

    const data = await trending.fetchAllTrending();
    trendingCache = data;
    trendingCacheTime = now;

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 推送热榜到 Telegram
app.post('/api/trending/:source/push', async (req, res) => {
  const { source } = req.params;
  const { limit = 10 } = req.body;

  if (!trending.TRENDING_SOURCES[source]) {
    return res.status(404).json({ success: false, error: '不支持的热榜源' });
  }

  if (!currentBot) {
    return res.status(503).json({ success: false, error: 'Bot 未运行' });
  }

  try {
    const items = await trending.fetchTrending(source);
    const message = trending.formatTrendingMessage(source, items, limit);

    if (!message) {
      return res.status(500).json({ success: false, error: '获取热榜数据失败' });
    }

    const settings = loadSettings();
    const chatId = settings.adminId;

    if (!chatId) {
      return res.status(400).json({ success: false, error: '未配置管理员 ID' });
    }

    await currentBot.telegram.sendMessage(chatId, message, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    storage.addLog('info', `推送热榜: ${trending.TRENDING_SOURCES[source].name}`, 'trending');
    res.json({ success: true, message: '推送成功' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== Price Monitor API ====================

const PriceMonitor = require('./price-monitor');

// 初始化价格监控器
let priceMonitor = null;

function initPriceMonitor() {
  if (priceMonitor) return;

  priceMonitor = new PriceMonitor(logger, async (data) => {
    // 价格变动回调 - 推送到 Telegram
    if (!currentBot) return;

    try {
      const settings = loadSettings();
      const chatId = settings.adminId;
      if (!chatId) return;

      const message = priceMonitor.formatPriceChangeMessage(data);
      await currentBot.telegram.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      });

      storage.addLog('info', `价格变动提醒: ${data.item.name} ¥${data.oldPrice} → ¥${data.newPrice}`, 'price');
    } catch (error) {
      logger.error(`推送价格变动失败: ${error.message}`);
    }
  });

  priceMonitor.startAll();
}

// 在服务启动时初始化
setTimeout(initPriceMonitor, 3000);

// 获取所有监控项
app.get('/api/price-monitors', (req, res) => {
  initPriceMonitor();
  const items = priceMonitor.getItems();
  res.json({ success: true, data: items });
});

// 获取单个监控项
app.get('/api/price-monitors/:id', (req, res) => {
  initPriceMonitor();
  const items = priceMonitor.getItems();
  const item = items.find(i => i.id === req.params.id);
  if (!item) {
    return res.status(404).json({ success: false, error: '监控项不存在' });
  }
  res.json({ success: true, data: item });
});

// 获取价格历史
app.get('/api/price-monitors/:id/history', (req, res) => {
  initPriceMonitor();
  const history = priceMonitor.getHistory(req.params.id);
  res.json({ success: true, data: history });
});

// 添加监控项
app.post('/api/price-monitors', (req, res) => {
  initPriceMonitor();
  const { url, selector, name, interval, targetPrice, notifyOnAnyChange, notifyOnDrop, dropThreshold } = req.body;

  if (!url || !selector) {
    return res.status(400).json({ success: false, error: '请提供商品链接和价格选择器' });
  }

  try {
    const item = priceMonitor.addItem({
      url,
      selector,
      name,
      interval: interval || 60,
      targetPrice: targetPrice || null,
      notifyOnAnyChange: notifyOnAnyChange !== false,
      notifyOnDrop: notifyOnDrop || false,
      dropThreshold: dropThreshold || 0,
    });
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新监控项
app.put('/api/price-monitors/:id', (req, res) => {
  initPriceMonitor();
  const item = priceMonitor.updateItem(req.params.id, req.body);
  if (!item) {
    return res.status(404).json({ success: false, error: '监控项不存在' });
  }
  res.json({ success: true, data: item });
});

// 删除监控项
app.delete('/api/price-monitors/:id', (req, res) => {
  initPriceMonitor();
  const deleted = priceMonitor.deleteItem(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, error: '监控项不存在' });
  }
  res.json({ success: true });
});

// 手动刷新价格
app.post('/api/price-monitors/:id/refresh', async (req, res) => {
  initPriceMonitor();
  try {
    const item = await priceMonitor.refreshItem(req.params.id);
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 测试价格提取
app.post('/api/price-monitors/test', async (req, res) => {
  initPriceMonitor();
  const { url, selector } = req.body;

  if (!url || !selector) {
    return res.status(400).json({ success: false, error: '请提供商品链接和价格选择器' });
  }

  try {
    const price = await priceMonitor.fetchPrice(url, selector);
    if (price === null) {
      return res.json({ success: false, error: '无法提取价格，请检查选择器是否正确' });
    }
    res.json({ success: true, data: { price } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== GitHub 监控 API ====================

// 初始化 GitHub 监控器
function initGithubMonitor() {
  if (githubMonitor) return githubMonitor;
  if (!currentBot) {
    logger.warn('GitHub 监控器初始化失败: Bot 未启动');
    return null;
  }

  githubMonitor = new GitHubMonitor(logger, async (data) => {
    // 更新回调 - 推送到管理员
    if (!currentBot) return;

    const settings = loadSettings();
    if (!settings.adminId) return;

    try {
      const message = githubMonitor.formatMessage(data);
      await currentBot.telegram.sendMessage(settings.adminId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
    } catch (error) {
      logger.error(`推送 GitHub 通知失败: ${error.message}`);
      storage.addLog('error', `推送 GitHub 通知失败: ${error.message}`, 'github');
    }
  });

  githubMonitor.start();
  return githubMonitor;
}

// 获取所有监控的仓库
app.get('/api/github/repos', (req, res) => {
  const repos = storage.getGithubRepos();
  res.json({ success: true, data: repos });
});

// 获取单个仓库详情
app.get('/api/github/repos/:id', async (req, res) => {
  const repos = storage.getGithubRepos();
  const repo = repos.find(r => r.id === req.params.id);

  if (!repo) {
    return res.status(404).json({ success: false, error: '仓库不存在' });
  }

  res.json({ success: true, data: repo });
});

// 添加仓库监控
app.post('/api/github/repos', async (req, res) => {
  const { repo: repoPath, watchTypes } = req.body;

  if (!repoPath) {
    return res.status(400).json({ success: false, error: '请提供仓库地址' });
  }

  // 解析仓库名
  let fullName = repoPath;
  const urlMatch = repoPath.match(/github\.com\/([^\/]+)\/([^\/\s]+)/);
  if (urlMatch) {
    fullName = `${urlMatch[1]}/${urlMatch[2]}`;
  }

  const parts = fullName.split('/');
  if (parts.length !== 2) {
    return res.status(400).json({ success: false, error: '仓库格式错误，正确格式: owner/repo' });
  }

  const [owner, repo] = parts;

  // 验证仓库是否存在
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'TG-Bot-GitHub-Monitor',
      },
    });

    if (response.status === 404) {
      return res.status(404).json({ success: false, error: '仓库不存在' });
    }

    if (!response.ok) {
      return res.status(500).json({ success: false, error: `GitHub API 错误: ${response.status}` });
    }

    const repoInfo = await response.json();

    // 添加监控
    const types = watchTypes || ['release'];
    const result = storage.addGithubRepo(owner, repo, types);

    if (result.success) {
      storage.addLog('info', `GitHub 添加监控: ${owner}/${repo}`, 'github');
      res.json({
        success: true,
        data: {
          ...result.data,
          repoInfo: {
            description: repoInfo.description,
            stars: repoInfo.stargazers_count,
            forks: repoInfo.forks_count,
            language: repoInfo.language,
          },
        },
      });
    } else {
      res.status(400).json({ success: false, error: result.error });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 更新仓库监控
app.put('/api/github/repos/:id', (req, res) => {
  const { watchTypes } = req.body;
  const updated = storage.updateGithubRepo(req.params.id, { watchTypes });

  if (updated) {
    res.json({ success: true, data: updated });
  } else {
    res.status(404).json({ success: false, error: '仓库不存在' });
  }
});

// 删除仓库监控
app.delete('/api/github/repos/:id', (req, res) => {
  const deleted = storage.deleteGithubRepo(req.params.id);

  if (deleted) {
    storage.addLog('info', `GitHub 取消监控: ${req.params.id}`, 'github');
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: '仓库不存在' });
  }
});

// 手动刷新单个仓库
app.post('/api/github/repos/:id/refresh', async (req, res) => {
  const monitor = initGithubMonitor();
  if (!monitor) {
    return res.status(503).json({ success: false, error: 'Bot 未启动' });
  }

  try {
    await monitor.refreshRepo(req.params.id);
    const repos = storage.getGithubRepos();
    const repo = repos.find(r => r.id === req.params.id);
    res.json({ success: true, data: repo });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 刷新所有仓库
app.post('/api/github/refresh-all', async (req, res) => {
  const monitor = initGithubMonitor();
  if (!monitor) {
    return res.status(503).json({ success: false, error: 'Bot 未启动' });
  }

  try {
    await monitor.checkAll();
    res.json({ success: true, message: '刷新完成' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取所有监控账号
app.get('/api/github/accounts', (req, res) => {
  const accounts = storage.getGithubOwners();
  res.json({ success: true, data: accounts });
});

// 添加账号监控
app.post('/api/github/accounts', async (req, res) => {
  const owner = String(req.body?.owner || '').trim();
  const ownerTypeInput = String(req.body?.ownerType || 'auto').toLowerCase();

  if (!owner) {
    return res.status(400).json({ success: false, error: '请提供 GitHub 账号' });
  }

  try {
    const response = await fetch(`https://api.github.com/users/${owner}`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'TG-Bot-GitHub-Monitor',
      },
    });

    if (response.status === 404) {
      return res.status(404).json({ success: false, error: 'GitHub 账号不存在' });
    }

    if (!response.ok) {
      return res.status(500).json({ success: false, error: `GitHub API 错误: ${response.status}` });
    }

    const profile = await response.json();
    const detectedType = profile.type === 'Organization' ? 'org' : 'user';
    const ownerType = ownerTypeInput === 'auto' ? detectedType : ownerTypeInput;

    if (!['user', 'org'].includes(ownerType)) {
      return res.status(400).json({ success: false, error: '账号类型仅支持 user 或 org' });
    }

    const result = storage.addGithubOwner(owner, ownerType);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    storage.addLog('info', `GitHub 添加账号监控: ${owner} (${ownerType})`, 'github');
    res.json({
      success: true,
      data: {
        ...result.data,
        profile: {
          login: profile.login,
          type: profile.type,
          publicRepos: profile.public_repos,
          url: profile.html_url,
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除账号监控
app.delete('/api/github/accounts/:id', (req, res) => {
  const deleted = storage.deleteGithubOwner(req.params.id);

  if (deleted) {
    storage.addLog('info', `GitHub 取消账号监控: ${req.params.id}`, 'github');
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, error: '账号监控不存在' });
  }
});

// 手动刷新单个账号
app.post('/api/github/accounts/:id/refresh', async (req, res) => {
  const monitor = initGithubMonitor();
  if (!monitor) {
    return res.status(503).json({ success: false, error: 'Bot 未启动' });
  }

  try {
    const account = await monitor.refreshOwner(req.params.id);
    res.json({ success: true, data: account });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取通知历史
app.get('/api/github/notifications', (req, res) => {
  const notifications = storage.getGithubNotifications();
  res.json({ success: true, data: notifications });
});

// 查询仓库信息（不添加监控）
app.get('/api/github/search', async (req, res) => {
  const { repo } = req.query;

  if (!repo) {
    return res.status(400).json({ success: false, error: '请提供仓库地址' });
  }

  let fullName = repo;
  const urlMatch = repo.match(/github\.com\/([^\/]+)\/([^\/\s]+)/);
  if (urlMatch) {
    fullName = `${urlMatch[1]}/${urlMatch[2]}`;
  }

  try {
    const response = await fetch(`https://api.github.com/repos/${fullName}`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'TG-Bot-GitHub-Monitor',
      },
    });

    if (!response.ok) {
      return res.status(404).json({ success: false, error: '仓库不存在' });
    }

    const repoInfo = await response.json();

    // 获取最新 Release
    let latestRelease = null;
    try {
      const releaseRes = await fetch(`https://api.github.com/repos/${fullName}/releases/latest`, {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'TG-Bot-GitHub-Monitor',
        },
      });
      if (releaseRes.ok) {
        latestRelease = await releaseRes.json();
      }
    } catch (e) {}

    res.json({
      success: true,
      data: {
        fullName: repoInfo.full_name,
        description: repoInfo.description,
        stars: repoInfo.stargazers_count,
        forks: repoInfo.forks_count,
        watchers: repoInfo.watchers_count,
        language: repoInfo.language,
        url: repoInfo.html_url,
        latestRelease: latestRelease ? {
          tag: latestRelease.tag_name,
          name: latestRelease.name,
          publishedAt: latestRelease.published_at,
          url: latestRelease.html_url,
        } : null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== Stickers API ====================

const os = require('os');
const zlib = require('zlib');
const { promisify } = require('util');
const { execFile } = require('child_process');
const renderLottie = require('puppeteer-lottie');
const sharp = require('sharp');
const execFileAsync = promisify(execFile);
const stickerCacheDir = path.join(getDataPath(), 'cache', 'stickers');
const puppeteerWSEndpoint = process.env.PUPPETEER_WS_ENDPOINT || null;

// 缓存配置
const STICKER_CACHE_MAX_AGE_DAYS = 7; // 缓存保留天数
const STICKER_CACHE_MAX_SIZE_MB = 500; // 最大缓存大小 (MB)

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// 清理过期的贴纸缓存
function cleanStickerCache() {
  if (!fs.existsSync(stickerCacheDir)) {
    return { deleted: 0, freedBytes: 0 };
  }

  const now = Date.now();
  const maxAge = STICKER_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  let freedBytes = 0;

  try {
    const files = fs.readdirSync(stickerCacheDir);

    // 获取所有文件的信息并按访问时间排序
    const fileInfos = files.map(file => {
      const filePath = path.join(stickerCacheDir, file);
      try {
        const stats = fs.statSync(filePath);
        return { file, filePath, stats, atime: stats.atimeMs, size: stats.size };
      } catch {
        return null;
      }
    }).filter(Boolean);

    // 删除过期文件
    for (const info of fileInfos) {
      if (now - info.atime > maxAge) {
        try {
          fs.unlinkSync(info.filePath);
          deleted++;
          freedBytes += info.size;
        } catch (e) {
          logger.warn(`删除缓存文件失败: ${info.file}: ${e.message}`);
        }
      }
    }

    // 如果缓存仍然过大，删除最旧的文件
    const remainingFiles = fileInfos.filter(info => fs.existsSync(info.filePath));
    let totalSize = remainingFiles.reduce((sum, info) => sum + info.size, 0);
    const maxSize = STICKER_CACHE_MAX_SIZE_MB * 1024 * 1024;

    if (totalSize > maxSize) {
      // 按访问时间排序，最旧的在前
      remainingFiles.sort((a, b) => a.atime - b.atime);

      for (const info of remainingFiles) {
        if (totalSize <= maxSize) break;
        try {
          fs.unlinkSync(info.filePath);
          deleted++;
          freedBytes += info.size;
          totalSize -= info.size;
        } catch (e) {
          logger.warn(`删除缓存文件失败: ${info.file}: ${e.message}`);
        }
      }
    }

    if (deleted > 0) {
      logger.info(`🧹 清理贴纸缓存: 删除 ${deleted} 个文件, 释放 ${(freedBytes / 1024 / 1024).toFixed(2)} MB`);
    }
  } catch (e) {
    logger.error(`清理缓存失败: ${e.message}`);
  }

  return { deleted, freedBytes };
}

// 获取缓存统计信息
function getStickerCacheStats() {
  if (!fs.existsSync(stickerCacheDir)) {
    return { fileCount: 0, totalSize: 0, totalSizeMB: '0.00' };
  }

  try {
    const files = fs.readdirSync(stickerCacheDir);
    let totalSize = 0;

    for (const file of files) {
      try {
        const stats = fs.statSync(path.join(stickerCacheDir, file));
        totalSize += stats.size;
      } catch {}
    }

    return {
      fileCount: files.length,
      totalSize,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2)
    };
  } catch {
    return { fileCount: 0, totalSize: 0, totalSizeMB: '0.00' };
  }
}

async function runFfmpeg(args) {
  await execFileAsync('ffmpeg', args);
}

async function fetchStickerFile(fileId) {
  const fetch = require('node-fetch');
  const file = await currentBot.telegram.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${currentBot.telegram.token}/${file.file_path}`;
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Telegram download failed: ${response.status}`);
  }
  return response.buffer();
}

async function convertTgsToGif(buffer, outputPath) {
  const animationData = JSON.parse(zlib.gunzipSync(buffer).toString('utf-8'));
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgs-frames-'));
  const fps = Number(animationData.fr) || 30;

  try {
    let browser = null;
    if (puppeteerWSEndpoint) {
      const puppeteer = require('puppeteer');
      browser = await puppeteer.connect({ browserWSEndpoint: puppeteerWSEndpoint });
    } else {
      browser = await getBrowser();
    }

    const shouldCloseBrowser = puppeteerWSEndpoint ? true : false;

    await renderLottie({
      animationData,
      output: path.join(framesDir, 'frame-%04d.png'),
      width: 512,
      height: 512,
      quiet: true,
      renderer: 'svg',
      browser,
      puppeteerOptions: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--single-process',
          '--no-zygote',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-sync',
          '--disable-translate',
          '--hide-scrollbars',
          '--metrics-recording-only',
          '--mute-audio',
          '--no-first-run',
        ],
      },
    });

    if (shouldCloseBrowser && browser) {
      await browser.disconnect();
    }

    await runFfmpeg([
      '-y',
      '-framerate',
      String(fps),
      '-i',
      path.join(framesDir, 'frame-%04d.png'),
      '-vf',
      'scale=512:-1:flags=lanczos',
      '-loop',
      '0',
      outputPath,
    ]);
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
}

async function convertWebmToGif(inputPath, outputPath) {
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    '-vf',
    'scale=512:-1:flags=lanczos',
    '-loop',
    '0',
    outputPath,
  ]);
}

function sanitizeFileName(name) {
  return String(name || 'sticker')
    .replace(/[\\/\?%\*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

async function convertWebpToPng(inputPath, outputPath) {
  await runFfmpeg([
    '-y',
    '-i',
    inputPath,
    outputPath,
  ]);
}

async function getConvertedStickerFile(fileId, type) {
  ensureDir(stickerCacheDir);
  const ext = type === 'static' ? 'png' : 'gif';
  const cachePath = path.join(stickerCacheDir, `${fileId}.${ext}`);

  if (fs.existsSync(cachePath)) {
    return { cachePath, ext };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sticker-'));
  const sourceExt = type === 'animated' ? 'tgs' : type === 'video' ? 'webm' : 'webp';
  const sourcePath = path.join(tempDir, `source.${sourceExt}`);
  const outputPath = path.join(tempDir, `output.${ext}`);

  try {
    const buffer = await fetchStickerFile(fileId);
    fs.writeFileSync(sourcePath, buffer);

    if (type === 'animated') {
      await convertTgsToGif(buffer, outputPath);
    } else if (type === 'video') {
      await convertWebmToGif(sourcePath, outputPath);
    } else {
      await convertWebpToPng(sourcePath, outputPath);
    }

    fs.copyFileSync(outputPath, cachePath);
    return { cachePath, ext };
  } catch (error) {
    if (fs.existsSync(cachePath)) {
      fs.unlinkSync(cachePath);
    }
    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const MAX_STICKERS_PER_PACK = 120;
const STICKER_IMPORT_MAX_FILE_SIZE = 512 * 1024;
const STICKER_IMPORT_ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/webp',
  'image/jpeg',
  'image/jpg',
  'image/gif',
]);

async function convertImageToStaticStickerPng(inputBuffer) {
  const sizeAttempts = [512, 480, 448, 416, 384, 352, 320, 288, 256];

  for (const size of sizeAttempts) {
    const outputBuffer = await sharp(inputBuffer, { animated: false, failOn: 'none' })
      .rotate()
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: true,
      })
      .png({
        compressionLevel: 9,
        palette: true,
        quality: 90,
        effort: 8,
      })
      .toBuffer();

    if (outputBuffer.length <= STICKER_IMPORT_MAX_FILE_SIZE) {
      return outputBuffer;
    }
  }

  throw new Error('图片转换后仍超过 512KB，请使用更简单或更小尺寸的图片');
}

// 获取所有贴纸包
app.get('/api/sticker-packs', (req, res) => {

  const packs = storage.getUserStickerPacks();
  res.json({ success: true, data: packs });
});

// 删除贴纸包（仅从本地记录删除，Telegram上的贴纸包需要手动删除）
app.delete('/api/sticker-packs/:name', (req, res) => {
  const packName = req.params.name;
  const packs = storage.getUserStickerPacks();
  const pack = packs.find(p => p.name === packName);

  if (!pack) {
    return res.status(404).json({ success: false, error: '贴纸包不存在' });
  }

  storage.deleteUserStickerPack(null, packName);
  res.json({ success: true });
});

// 获取贴纸包内的所有贴纸（从 Telegram 获取）
app.get('/api/sticker-packs/:name/stickers', async (req, res) => {
  if (!currentBot) {
    return res.status(503).json({ success: false, error: 'Bot 未运行' });
  }

  const packName = req.params.name;

  try {
    const stickerSet = await currentBot.telegram.getStickerSet(packName);

    const stickersWithUrls = await Promise.all(
      stickerSet.stickers.map(async (sticker) => {
        try {
          const type = sticker.is_animated ? 'animated' : sticker.is_video ? 'video' : 'static';
          return {
            fileId: sticker.file_id,
            emoji: sticker.emoji,
            isAnimated: sticker.is_animated,
            isVideo: sticker.is_video,
            width: sticker.width,
            height: sticker.height,
            fileUrl: `/api/stickers/preview/${sticker.file_id}?type=${type}`,
          };
        } catch (e) {
          return {
            fileId: sticker.file_id,
            emoji: sticker.emoji,
            isAnimated: sticker.is_animated,
            isVideo: sticker.is_video,
            error: e.message,
          };
        }
      })
    );

    res.json({
      success: true,
      data: {
        name: stickerSet.name,
        title: stickerSet.title,
        stickerType: stickerSet.sticker_type,
        isAnimated: stickerSet.is_animated,
        isVideo: stickerSet.is_video,
        stickers: stickersWithUrls,
      }
    });
  } catch (error) {
    logger.error(`获取贴纸包失败: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 预览贴纸（转换为 GIF/PNG）
app.get('/api/stickers/preview/:fileId', async (req, res) => {
  if (!currentBot) {
    return res.status(503).json({ success: false, error: 'Bot 未运行' });
  }

  const { fileId } = req.params;
  const type = req.query.type;
  const resolvedType = type === 'animated' || type === 'video' || type === 'static' ? type : null;

  if (!resolvedType) {
    return res.status(400).json({ success: false, error: 'Invalid sticker type' });
  }

  try {
    const { cachePath, ext } = await getConvertedStickerFile(fileId, resolvedType);
    res.setHeader('Content-Type', ext === 'gif' ? 'image/gif' : 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(cachePath);
  } catch (error) {
    logger.error(`预览贴纸失败: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 导出贴纸包为 ZIP（GIF/PNG）
app.get('/api/sticker-packs/:name/export', async (req, res) => {
  if (!currentBot) {
    return res.status(503).json({ success: false, error: 'Bot 未运行' });
  }

  const packName = req.params.name;

  try {
    const stickerSet = await currentBot.telegram.getStickerSet(packName);

    // 先收集所有转换后的文件，避免在响应开始后无法返回错误
    const convertedFiles = [];
    let failCount = 0;

    logger.info(`开始导出贴纸包: ${packName}, 共 ${stickerSet.stickers.length} 个贴纸`);

    for (let i = 0; i < stickerSet.stickers.length; i++) {
      const sticker = stickerSet.stickers[i];
      const type = sticker.is_animated ? 'animated' : sticker.is_video ? 'video' : 'static';
      try {
        const { cachePath, ext } = await getConvertedStickerFile(sticker.file_id, type);
        const safeName = sanitizeFileName(sticker.emoji || 'sticker');
        const fileName = `${String(i + 1).padStart(3, '0')}_${safeName}.${ext}`;
        convertedFiles.push({ cachePath, fileName });
        logger.debug(`转换成功 [${i + 1}/${stickerSet.stickers.length}]: ${fileName}`);
      } catch (e) {
        failCount++;
        logger.warn(`导出贴纸包失败 [${i + 1}/${stickerSet.stickers.length}] (类型: ${type}): ${e.message}`);
      }
    }

    // 如果所有贴纸都转换失败，返回错误
    if (convertedFiles.length === 0) {
      logger.error(`贴纸包导出失败: ${packName}, 所有 ${stickerSet.stickers.length} 个贴纸转换失败`);
      return res.status(500).json({
        success: false,
        error: `所有 ${stickerSet.stickers.length} 个贴纸转换失败，请检查后端日志`
      });
    }

    // 现在可以安全地设置响应头并发送 ZIP
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${packName}_${Date.now()}.zip"`);
    res.setHeader('Cache-Control', 'no-store');

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);

    // 添加所有转换成功的文件
    for (const { cachePath, fileName } of convertedFiles) {
      archive.file(cachePath, { name: fileName });
    }

    const metadata = {
      exportedAt: new Date().toISOString(),
      packName: stickerSet.name,
      title: stickerSet.title,
      totalStickers: stickerSet.stickers.length,
      successCount: convertedFiles.length,
      failCount,
      stickers: stickerSet.stickers.map(s => ({
        emoji: s.emoji,
        isAnimated: s.is_animated,
        isVideo: s.is_video,
      })),
    };
    archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

    await archive.finalize();
    logger.info(`贴纸包导出完成: ${packName}, 成功: ${convertedFiles.length}, 失败: ${failCount}`);
  } catch (error) {
    logger.error(`导出贴纸包失败: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// 获取贴纸缓存统计
app.get('/api/stickers/cache/stats', (req, res) => {
  const stats = getStickerCacheStats();
  res.json({
    success: true,
    data: {
      ...stats,
      maxAgeDays: STICKER_CACHE_MAX_AGE_DAYS,
      maxSizeMB: STICKER_CACHE_MAX_SIZE_MB
    }
  });
});

// 手动清理贴纸缓存
app.post('/api/stickers/cache/clean', (req, res) => {
  const result = cleanStickerCache();
  const stats = getStickerCacheStats();
  res.json({
    success: true,
    data: {
      deleted: result.deleted,
      freedMB: (result.freedBytes / 1024 / 1024).toFixed(2),
      currentStats: stats
    }
  });
});


// 获取所有贴纸
app.get('/api/stickers', (req, res) => {
  const stickers = storage.getStickers();
  res.json({ success: true, data: stickers });
});

// 获取单个贴纸
app.get('/api/stickers/:id', (req, res) => {
  const stickers = storage.getStickers();
  const sticker = stickers.find(s => s.id === req.params.id);
  if (!sticker) {
    return res.status(404).json({ success: false, error: '贴纸不存在' });
  }
  res.json({ success: true, data: sticker });
});

// 更新贴纸（标签、分组）
app.put('/api/stickers/:id', (req, res) => {
  const { tags, groupId } = req.body;
  const stickers = storage.getStickers();
  const sticker = stickers.find(s => s.id === req.params.id);

  if (!sticker) {
    return res.status(404).json({ success: false, error: '贴纸不存在' });
  }

  const updated = storage.updateSticker(req.params.id, sticker.userId, { tags, groupId });
  res.json({ success: true, data: updated });
});

// 删除贴纸
app.delete('/api/stickers/:id', (req, res) => {
  const stickers = storage.getStickers();
  const sticker = stickers.find(s => s.id === req.params.id);

  if (!sticker) {
    return res.status(404).json({ success: false, error: '贴纸不存在' });
  }

  const deleted = storage.deleteSticker(req.params.id, sticker.userId);
  if (!deleted) {
    return res.status(404).json({ success: false, error: '贴纸不存在' });
  }
  res.json({ success: true });
});

// 获取贴纸分组
app.get('/api/stickers/groups', (req, res) => {
  const groups = storage.getStickerGroups();
  // 添加每个分组的贴纸数量
  const stickers = storage.getStickers();
  const groupsWithCount = groups.map(g => ({
    ...g,
    count: stickers.filter(s => s.groupId === g.id).length,
  }));
  res.json({ success: true, data: groupsWithCount });
});

// 创建贴纸分组
app.post('/api/stickers/groups', (req, res) => {
  const { name, userId } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, error: '分组名称不能为空' });
  }
  const group = storage.addStickerGroup(name, userId || 'admin');
  res.json({ success: true, data: group });
});

// 更新贴纸分组
app.put('/api/stickers/groups/:id', (req, res) => {
  const { name } = req.body;
  const groups = storage.getStickerGroups();
  const group = groups.find(g => g.id === req.params.id);

  if (!group) {
    return res.status(404).json({ success: false, error: '分组不存在' });
  }

  const updated = storage.updateStickerGroup(req.params.id, group.userId, { name });
  res.json({ success: true, data: updated });
});

// 删除贴纸分组
app.delete('/api/stickers/groups/:id', (req, res) => {
  const groups = storage.getStickerGroups();
  const group = groups.find(g => g.id === req.params.id);

  if (!group) {
    return res.status(404).json({ success: false, error: '分组不存在' });
  }

  const deleted = storage.deleteStickerGroup(req.params.id, group.userId);
  if (!deleted) {
    return res.status(404).json({ success: false, error: '分组不存在' });
  }
  res.json({ success: true });
});

// ==================== Stickers Import/Export API ====================

const archiver = require('archiver');
const multer = require('multer');

// 配置 multer 用于文件上传
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: STICKER_IMPORT_MAX_FILE_SIZE,
    files: 120, // 最多 120 个文件
  },
  fileFilter: (req, file, cb) => {
    if (STICKER_IMPORT_ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 PNG/WebP/JPG/JPEG/GIF 格式'));
    }
  },
});

// 导出贴纸为 ZIP
app.get('/api/stickers/export', async (req, res) => {
  if (!currentBot) {
    return res.status(503).json({ success: false, error: 'Bot 未运行' });
  }

  const stickers = storage.getStickers();
  if (stickers.length === 0) {
    return res.status(400).json({ success: false, error: '没有可导出的贴纸' });
  }

  try {
    const fetch = require('node-fetch');

    // 设置响应头
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="stickers_${Date.now()}.zip"`);

    // 创建 ZIP 归档
    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.pipe(res);

    // 下载并添加每个贴纸
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < stickers.length; i++) {
      const sticker = stickers[i];
      try {
        const file = await currentBot.telegram.getFile(sticker.fileId);
        const fileUrl = `https://api.telegram.org/file/bot${currentBot.telegram.token}/${file.file_path}`;

        const response = await fetch(fileUrl);
        if (!response.ok) {
          failCount++;
          continue;
        }

        const buffer = await response.buffer();

        // 确定文件扩展名
        const ext = sticker.isAnimated ? 'tgs' : sticker.isVideo ? 'webm' : 'webp';
        const fileName = `${String(i + 1).padStart(3, '0')}_${sticker.emoji || 'sticker'}.${ext}`;

        archive.append(buffer, { name: fileName });
        successCount++;

        // 每下载 10 个贴纸暂停一下
        if (i % 10 === 9) {
          await new Promise(r => setTimeout(r, 100));
        }
      } catch (e) {
        failCount++;
        logger.warn(`导出贴纸失败: ${e.message}`);
      }
    }

    // 添加元数据文件
    const metadata = {
      exportedAt: new Date().toISOString(),
      totalStickers: stickers.length,
      successCount,
      failCount,
      stickers: stickers.map(s => ({
        emoji: s.emoji,
        setName: s.setName,
        tags: s.tags,
        isAnimated: s.isAnimated,
        isVideo: s.isVideo,
      })),
    };
    archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

    await archive.finalize();

    storage.addLog('info', `导出贴纸: ${successCount}/${stickers.length}`, 'sticker');
  } catch (error) {
    logger.error(`导出贴纸失败: ${error.message}`);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

// 导入贴纸（上传图片创建贴纸包）
app.post('/api/stickers/import', upload.array('stickers', 120), async (req, res) => {
  if (!currentBot) {
    return res.status(503).json({ success: false, error: 'Bot 未运行' });
  }

  const settings = loadSettings();
  if (!settings.adminId) {
    return res.status(400).json({ success: false, error: '未配置管理员 ID' });
  }

  const files = req.files;
  const packMode = req.body.packMode === 'existing' ? 'existing' : 'new';
  const targetPackName = String(req.body.packName || '').trim();
  const packTitle = req.body.title || `导入贴纸包 ${new Date().toLocaleDateString('zh-CN')}`;
  const emojis = req.body.emojis || '😀'; // 默认表情

  if (!files || files.length === 0) {
    return res.status(400).json({ success: false, error: '请上传贴纸图片文件' });
  }

  if (packMode === 'existing' && !targetPackName) {
    return res.status(400).json({ success: false, error: '请选择要导入的贴纸包' });
  }

  try {
    const botInfo = await currentBot.telegram.getMe();
    const botUsername = botInfo.username;
    const userId = Number(settings.adminId);
    let packName = targetPackName;
    let finalPackTitle = packTitle;
    let addedCount = 0;
    const errors = [];

    if (packMode === 'existing') {
      const stickerSet = await currentBot.telegram.getStickerSet(targetPackName);
      const isStaticPack = !stickerSet.is_animated && !stickerSet.is_video;

      if (!isStaticPack) {
        return res.status(400).json({
          success: false,
          error: '当前仅支持导入图片到静态贴纸包（动态/视频贴纸包暂不支持）',
        });
      }

      const remainingSlots = MAX_STICKERS_PER_PACK - stickerSet.stickers.length;
      if (remainingSlots <= 0) {
        return res.status(400).json({ success: false, error: '贴纸包已满（最多 120 个贴纸）' });
      }
      if (files.length > remainingSlots) {
        return res.status(400).json({
          success: false,
          error: `贴纸包剩余容量不足，还可添加 ${remainingSlots} 个贴纸`,
        });
      }

      finalPackTitle = stickerSet.title || targetPackName;

      for (let i = 0; i < files.length; i++) {
        try {
          const stickerBuffer = await convertImageToStaticStickerPng(files[i].buffer);
          await currentBot.telegram.addStickerToSet(
            userId,
            packName,
            {
              png_sticker: { source: stickerBuffer },
              emojis: emojis,
            }
          );
          addedCount++;

          if (i % 5 === 0) {
            await new Promise(r => setTimeout(r, 300));
          }
        } catch (e) {
          errors.push(`文件 ${i + 1}: ${e.message}`);
          logger.warn(`添加贴纸失败: ${e.message}`);
        }
      }

      if (addedCount === 0) {
        return res.status(500).json({ success: false, error: '所有图片都导入失败，请检查图片格式或大小' });
      }

      const localPackRecord = storage.getUserStickerPacks().find(p => p.name === packName);
      if (localPackRecord) {
        storage.updateUserStickerPack(localPackRecord.userId, packName, {
          title: finalPackTitle,
          stickerType: 'static',
          stickerCount: (localPackRecord.stickerCount || 0) + addedCount,
        });
      } else {
        storage.addUserStickerPack({
          userId: settings.adminId.toString(),
          name: packName,
          title: finalPackTitle,
          stickerType: 'static',
          stickerCount: stickerSet.stickers.length + addedCount,
          isImported: true,
        });
      }
    } else {
      packName = `import_${Date.now()}_by_${botUsername}`;

      const firstFile = files[0];
      const firstStickerBuffer = await convertImageToStaticStickerPng(firstFile.buffer);

      await currentBot.telegram.createNewStickerSet(
        userId,
        packName,
        finalPackTitle,
        {
          png_sticker: { source: firstStickerBuffer },
          emojis: emojis,
        }
      );

      logger.info(`创建导入贴纸包: ${packName}`);
      addedCount = 1;

      for (let i = 1; i < files.length; i++) {
        try {
          const stickerBuffer = await convertImageToStaticStickerPng(files[i].buffer);
          await currentBot.telegram.addStickerToSet(
            userId,
            packName,
            {
              png_sticker: { source: stickerBuffer },
              emojis: emojis,
            }
          );
          addedCount++;

          if (i % 5 === 0) {
            await new Promise(r => setTimeout(r, 300));
          }
        } catch (e) {
          errors.push(`文件 ${i + 1}: ${e.message}`);
          logger.warn(`添加贴纸失败: ${e.message}`);
        }
      }

      storage.addUserStickerPack({
        userId: settings.adminId.toString(),
        name: packName,
        title: finalPackTitle,
        stickerType: 'static',
        stickerCount: addedCount,
        isImported: true,
      });
    }

    const actionLabel = packMode === 'existing' ? '导入到已有贴纸包' : '导入创建贴纸包';
    storage.addLog('info', `${actionLabel}: ${finalPackTitle} (${addedCount} 个)`, 'sticker');

    res.json({
      success: true,
      data: {
        mode: packMode,
        packName,
        packTitle: finalPackTitle,
        stickerCount: addedCount,
        totalUploaded: files.length,
        errors: errors.length > 0 ? errors : undefined,
        link: `https://t.me/addstickers/${packName}`,
      },
    });
  } catch (error) {
    logger.error(`导入贴纸失败: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 处理 multer 错误
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: '文件大小超过限制 (512KB)' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ success: false, error: '文件数量超过限制 (最多120个)' });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err.message === '只支持 PNG/WebP/JPG/JPEG/GIF 格式') {
    return res.status(400).json({ success: false, error: err.message });
  }
  next(err);
});

// ==================== Notes API ====================

app.get('/api/notes', (req, res) => {
  const notes = storage.getNotes();
  res.json({ success: true, data: notes });
});

app.post('/api/notes', (req, res) => {
  const { content } = req.body;
  if (!content) {
    return res.status(400).json({ success: false, error: '内容不能为空' });
  }
  const note = storage.addNote(content);
  res.json({ success: true, data: note });
});

app.put('/api/notes/:id', (req, res) => {
  const note = storage.updateNote(req.params.id, req.body);
  if (!note) {
    return res.status(404).json({ success: false, error: '笔记不存在' });
  }
  res.json({ success: true, data: note });
});

app.delete('/api/notes/:id', (req, res) => {
  const deleted = storage.deleteNote(req.params.id);
  if (!deleted) {
    return res.status(404).json({ success: false, error: '笔记不存在' });
  }
  res.json({ success: true });
});

// ==================== Backup API ====================

const webdav = require('./webdav');

// 下载本地备份
app.get('/api/backup', (req, res) => {
  try {
    const backupFile = storage.createBackup();
    res.download(backupFile);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 测试 WebDAV 连接
app.post('/api/backup/webdav/test', async (req, res) => {
  const settings = loadSettings();
  const config = settings.webdav || {};

  if (!config.url || !config.username || !config.password) {
    return res.status(400).json({ success: false, error: '请先配置 WebDAV 连接信息' });
  }

  const result = await webdav.testConnection(config);
  res.json(result);
});

// 备份到 WebDAV
app.post('/api/backup/webdav/upload', async (req, res) => {
  try {
    const settings = loadSettings();
    const config = settings.webdav || {};

    if (!config.url || !config.username || !config.password) {
      return res.status(400).json({ success: false, error: '请先配置 WebDAV 连接信息' });
    }

    // 创建备份数据
    const backupData = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      config: { ...settings, webdav: { ...settings.webdav, password: '***' } }, // 隐藏密码
      notes: storage.getNotes(),
      reminders: storage.getReminders(),
      stats: storage.getStats(),
      tools: storage.getTools(),
      subscriptions: scheduler?.getSubscriptions() || [], // RSS 订阅
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const remotePath = `${config.remotePath || '/tgbot-backup'}/backup_${timestamp}.json`;
    const content = JSON.stringify(backupData, null, 2);

    const result = await webdav.uploadFile(config, remotePath, content);

    if (result.success) {
      storage.addLog('info', `WebDAV 备份成功: ${remotePath}`, 'backup');
      res.json({ success: true, message: '备份成功', path: remotePath });
    } else {
      res.json(result);
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 列出 WebDAV 备份
app.get('/api/backup/webdav/list', async (req, res) => {
  const settings = loadSettings();
  const config = settings.webdav || {};

  if (!config.url) {
    return res.json({ success: true, data: [] });
  }

  const remotePath = config.remotePath || '/tgbot-backup';
  const result = await webdav.listFiles(config, remotePath);
  res.json(result);
});

// 从 WebDAV 恢复备份
app.post('/api/backup/webdav/restore', async (req, res) => {
  try {
    const { path: remotePath } = req.body;
    const settings = loadSettings();
    const config = settings.webdav || {};

    if (!remotePath) {
      return res.status(400).json({ success: false, error: '请指定备份文件路径' });
    }

    const result = await webdav.downloadFile(config, remotePath);

    if (!result.success) {
      return res.json(result);
    }

    const backupData = JSON.parse(result.data);

    // 恢复数据（保留当前的 webdav 配置）
    if (backupData.config) {
      const currentWebdav = settings.webdav;
      const newSettings = { ...settings, ...backupData.config, webdav: currentWebdav };
      saveSettings(newSettings);
    }

    // 恢复其他数据需要更复杂的逻辑，暂时只恢复配置
    storage.addLog('info', `从 WebDAV 恢复备份: ${remotePath}`, 'backup');

    res.json({ success: true, message: '恢复成功，请重启 Bot 使配置生效' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 删除 WebDAV 备份
app.delete('/api/backup/webdav/:filename', async (req, res) => {
  const settings = loadSettings();
  const config = settings.webdav || {};
  const remotePath = `${config.remotePath || '/tgbot-backup'}/${req.params.filename}`;

  const result = await webdav.deleteFile(config, remotePath);
  res.json(result);
});

// ==================== 定时 WebDAV 备份 ====================

let backupTimer = null;

async function runAutoBackup() {
  const settings = loadSettings();
  const config = settings.webdav || {};

  if (!config.autoBackup || !config.url || !config.username || !config.password) {
    return;
  }

  logger.info('⏰ 执行定时 WebDAV 备份...');

  try {
    // 创建备份数据
    const backupData = {
      timestamp: new Date().toISOString(),
      version: '1.0',
      config: { ...settings, webdav: { ...settings.webdav, password: '***' } },
      notes: storage.getNotes(),
      reminders: storage.getReminders(),
      stats: storage.getStats(),
      tools: storage.getTools(),
      subscriptions: scheduler?.getSubscriptions() || [],
    };

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const remotePath = `${config.remotePath || '/tgbot-backup'}/backup_${timestamp}.json`;
    const content = JSON.stringify(backupData, null, 2);

    const result = await webdav.uploadFile(config, remotePath, content);

    if (result.success) {
      logger.info(`✅ 定时备份成功: ${remotePath}`);
      storage.addLog('info', `定时备份成功: ${remotePath}`, 'backup');

      // 清理过期备份（保留 3 天）
      await cleanOldBackups(config);
    } else {
      logger.error(`❌ 定时备份失败: ${result.error}`);
      storage.addLog('error', `定时备份失败: ${result.error}`, 'backup');
    }
  } catch (error) {
    logger.error(`❌ 定时备份异常: ${error.message}`);
    storage.addLog('error', `定时备份异常: ${error.message}`, 'backup');
  }
}

async function cleanOldBackups(config) {
  try {
    const remotePath = config.remotePath || '/tgbot-backup';
    const result = await webdav.listFiles(config, remotePath);

    if (!result.success || !result.data) return;

    const now = new Date();
    const maxAge = 3 * 24 * 60 * 60 * 1000; // 3 天

    for (const file of result.data) {
      if (file.modified) {
        const fileDate = new Date(file.modified);
        if (now - fileDate > maxAge) {
          logger.info(`🗑️ 清理过期备份: ${file.name}`);
          await webdav.deleteFile(config, file.path);
          storage.addLog('info', `清理过期备份: ${file.name}`, 'backup');
        }
      }
    }
  } catch (error) {
    logger.error(`清理备份失败: ${error.message}`);
  }
}

function startBackupScheduler() {
  if (backupTimer) {
    clearInterval(backupTimer);
  }

  const settings = loadSettings();
  const config = settings.webdav || {};

  if (config.autoBackup && config.url) {
    const interval = (config.autoBackupInterval || 24) * 60 * 60 * 1000; // 小时转毫秒
    logger.info(`📅 启动定时备份，间隔: ${config.autoBackupInterval || 24} 小时`);

    // 立即执行一次
    setTimeout(runAutoBackup, 5000);

    // 定时执行
    backupTimer = setInterval(runAutoBackup, interval);
  }
}

async function startBot() {
  // 停止旧实例
  if (currentBot) {
    try {
      scheduler?.stopAll();
      await currentBot.stop();
      logger.info('🛑 旧 Bot 实例已停止');
    } catch (e) {
      logger.error(`停止旧实例失败: ${e.message}`);
    }
    currentBot = null;
  }

  let settings = loadSettings();
  const maskedSecretValue = '***已配置***';

  if (settings.botToken === maskedSecretValue) {
    logger.warn('⚠️ 检测到无效的 botToken 掩码值，已视为未配置');
    settings.botToken = '';
  }

  // 首次启动时从环境变量读取并保存（仅当 config.json 中未配置时）
  if (!settings.botToken && process.env.BOT_TOKEN) {
    settings.botToken = process.env.BOT_TOKEN;
    settings.adminId = process.env.ADMIN_ID || settings.adminId;
    saveSettings(settings);
    logger.info('📝 已从环境变量导入初始配置到 config.json');
  }

  if (!settings.botToken) {
    logger.warn('❌ 未配置 Bot Token，请在面板中配置');
    return;
  }

  // 创建 Bot 实例
  const botOptions = {};
  if (settings.tgApiBase) {
    botOptions.telegram = { apiRoot: settings.tgApiBase };
  }
  const bot = new Telegraf(settings.botToken, botOptions);

  // 管理员检查函数
  const isAdmin = (ctx) => {
    if (!settings.adminId) return false;
    return String(ctx.from?.id) === String(settings.adminId);
  };

  // 初始化调度器
  scheduler = new RssScheduler(parseRssFeed, logger, async (subscription, newItems) => {
    const currentSettings = loadSettings();
    const globalRss = currentSettings.rss || {};

    // 优先级：订阅独立配置（需开启 useCustomPush）> 全局 RSS 配置 > 系统默认
    let targetToken = null;
    let targetChatId = null;
    let botLabel = '系统 Bot';

    // 1. 检查订阅是否启用独立配置
    if (subscription.useCustomPush && subscription.customBotToken) {
      targetToken = subscription.customBotToken;
      targetChatId = subscription.customChatId || subscription.chatId;
      botLabel = '订阅独立 Bot';
    }
    // 2. 检查全局 RSS 配置
    else if (globalRss.customBotToken) {
      targetToken = globalRss.customBotToken;
      targetChatId = globalRss.customChatId || subscription.chatId;
      botLabel = '全局 RSS Bot';
    }
    // 3. 使用系统默认
    else {
      targetChatId = subscription.chatId;
    }

    if (!targetChatId) {
      logger.warn(`[${subscription.title}] 无推送目标，跳过`);
      return;
    }

    // 确定使用哪个 Telegram API
    let telegramApi;

    if (targetToken) {
      try {
        const tempBot = new Telegraf(targetToken);
        telegramApi = tempBot.telegram;
      } catch (e) {
        logger.error(`[${subscription.title}] Bot Token 无效: ${e.message}`);
        storage.addLog('error', `${botLabel} Token 无效: ${e.message}`, 'rss');
        return;
      }
    } else if (currentBot) {
      telegramApi = currentBot.telegram;
    } else {
      logger.warn(`[${subscription.title}] 系统 Bot 未就绪，跳过推送`);
      return;
    }

    // 推送新内容
    for (const item of newItems.slice(0, 5)) { // 最多推送 5 条
      try {
        // 使用消息模板
        const template = globalRss.messageTemplate || '📰 <b>{feed_title}</b>\n{title}\n{link}';
        const message = template
          .replace(/{feed_title}/g, subscription.title || '')
          .replace(/{title}/g, item.title || '')
          .replace(/{link}/g, item.link || '')
          .replace(/{description}/g, (item.description || '').substring(0, 200))
          .replace(/{date}/g, item.pubDate ? new Date(item.pubDate).toLocaleString('zh-CN') : '');

        await telegramApi.sendMessage(targetChatId, message, {
          parse_mode: 'HTML',
          disable_web_page_preview: false,  // 显示链接预览
        });
        // 记录日志
        storage.addLog('info', `[${botLabel}] 推送: [${subscription.title}] ${item.title}`, 'rss');
      } catch (e) {
        logger.error(`推送失败: ${e.message}`);
        storage.addLog('error', `[${botLabel}] 推送失败: ${e.message}`, 'rss');
      }
    }

    // 保存到历史
    for (const item of newItems) {
      scheduler.saveNewItemToHistory(subscription, item);
    }
  });

  // 加载命令
  loadCommands(bot, { isAdmin, scheduler, logger, settings });

  currentBot = bot;

  // 启动 (带重试)
  const MAX_RETRIES = 5;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`🚀 正在启动 Bot... (尝试 ${attempt}/${MAX_RETRIES})`);
      const botInfo = await bot.telegram.getMe();
      logger.info(`✅ 连接成功: @${botInfo.username}`);

      bot.launch({ dropPendingUpdates: true }).catch(err => {
        logger.error(`❌ Bot 运行时错误: ${err.message}`);
      });

      logger.info('✅ Bot 轮询已开始');
      storage.addLog('info', `Bot 启动成功: @${botInfo.username}`, 'bot');

      // 启动调度器
      scheduler.startAll();

      // 启动提醒检查
      setInterval(() => checkReminders(bot), 60000);
      checkReminders(bot); // 立即检查一次

      // 发送启动通知
      if (settings.adminId) {
        try {
          await bot.telegram.sendMessage(
            settings.adminId,
            `✅ <b>Bot 已成功启动</b>\n\n⏱ 启动时间: ${new Date().toLocaleString('zh-CN')}\n📊 所有功能正常运行`,
            { parse_mode: 'HTML' }
          );
        } catch (e) {
          logger.warn(`发送启动通知失败: ${e.message}`);
        }
      }

      // 启动成功，退出重试循环
      return;
    } catch (err) {
      logger.error(`❌ 启动失败 (${attempt}/${MAX_RETRIES}): ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, attempt * 3000));
      }
    }
  }

  logger.error('❌ Bot 启动失败，已达到最大重试次数');
  storage.addLog('error', 'Bot 启动失败，已达最大重试次数', 'bot');
}


// ==================== 主函数 ====================

const PORT = process.env.PORT || 3001;

// SPA fallback - 必须放在所有 API 路由之后
if (fs.existsSync(publicPath)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', async () => {
  logger.info(`🚀 Backend server running on port ${PORT}`);
  logger.info(`📋 Web Panel: http://localhost:${PORT}`);

  // 尝试启动 Bot
  try {
    await startBot();
  } catch (err) {
    logger.error(`初始启动失败: ${err.message}`);
  }

  // 启动定时备份
  startBackupScheduler();

  // 启动时清理一次贴纸缓存
  cleanStickerCache();

  // 每 6 小时清理一次贴纸缓存
  setInterval(() => {
    cleanStickerCache();
  }, 6 * 60 * 60 * 1000);
});

// 优雅退出
const stopSignals = ['SIGINT', 'SIGTERM'];
stopSignals.forEach(signal => {
  process.once(signal, async () => {
    logger.info('正在关闭服务...');
    scheduler?.stopAll();
    if (currentBot) {
      await currentBot.stop(signal);
    }
    await closeBrowser();
    process.exit(0);
  });
});
