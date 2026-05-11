/**
 * TG 多功能机器人 - 主入口
 * 参考 tgbot 架构 + 优化
 */
const express = require('express');
const http = require('http');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const createLogger = require('./logger');
const { authMiddleware, registerAuthRoutes, verifyToken } = require('./auth');
const registerLogsRoutes = require('./routes/logs.routes');
const registerNotificationsRoutes = require('./routes/notifications.routes');
const registerScheduledTasksRoutes = require('./routes/scheduled-tasks.routes');
const registerRemindersRoutes = require('./routes/reminders.routes');
const registerNotesRoutes = require('./routes/notes.routes');
const registerStatusRoutes = require('./routes/status.routes');
const registerMessageRoutes = require('./routes/message.routes');
const registerStatsRoutes = require('./routes/stats.routes');
const registerAiProvidersRoutes = require('./routes/ai-providers.routes');
const registerToolsRoutes = require('./routes/tools.routes');
const registerRssRoutes = require('./routes/rss.routes');
const registerTrendingRoutes = require('./routes/trending.routes');
const registerPriceMonitorRoutes = require('./routes/price-monitor.routes');
const registerGithubRoutes = require('./routes/github.routes');
const registerBackupRoutes = require('./routes/backup.routes');
const registerStickersRoutes = require('./routes/stickers.routes');
const createBotManager = require('./bot-manager');
const TaskRegistry = require('./task-registry');
const attachRealtime = require('./realtime');
const { loadSettings, saveSettings, getDataPath } = require('./settings');
const { loadCommands } = require('./commands/loader');
const { parseRssFeed } = require('./rss-parser');
const { closeBrowser } = require('./puppeteer.service');

const storage = require('./storage');

const logger = createLogger();

const app = express();
let currentBot = null;
let scheduler = null;
let githubRoutes = null;
let backupRoutes = null;
let stickersRoutes = null;
let realtime = null;
const taskRegistry = new TaskRegistry();

function getStatusPayload(overrides = {}) {
  const settings = loadSettings();
  return {
    running: !!currentBot,
    configured: !!settings.botToken,
    subscriptions: scheduler?.getSubscriptions?.().length || 0,
    ...overrides,
  };
}

function broadcastStatus(overrides = {}) {
  realtime?.broadcast({ type: 'status', data: getStatusPayload(overrides) });
}

const botManager = createBotManager({
  loadSettings,
  saveSettings,
  loadCommands,
  parseRssFeed,
  storage,
  logger,
  taskRegistry,
  getBot: () => currentBot,
  setBot: bot => { currentBot = bot; },
  getScheduler: () => scheduler,
  setScheduler: nextScheduler => { scheduler = nextScheduler; },
  onStatusChange: broadcastStatus,
  onRssUpdate: payload => realtime?.broadcast({ type: 'rss_update', data: payload }),
});

const { startBot, stopBot } = botManager;

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
    broadcastStatus({ configured: !!newSettings.botToken });

    const githubMonitor = githubRoutes?.getGithubMonitor();
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
    await stopBot('RESTART');

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

// 应用认证中间件到所有路由
app.use(authMiddleware);
registerAuthRoutes(app, { loadSettings, saveSettings });

// Bot 状态
registerStatusRoutes(app, {
  loadSettings,
  getCurrentBot: () => currentBot,
  getScheduler: () => scheduler,
});

// ==================== RSS API ====================

registerRssRoutes(app, {
  loadSettings,
  parseRssFeed,
  getScheduler: () => scheduler,
});

// ==================== Message API ====================

registerMessageRoutes(app, {
  loadSettings,
  getCurrentBot: () => currentBot,
});

// ==================== Stats API ====================

registerStatsRoutes(app, {
  storage,
  getCurrentBot: () => currentBot,
  getScheduler: () => scheduler,
});

// ==================== Notifications API ====================

registerNotificationsRoutes(app, {
  loadSettings,
  getCurrentBot: () => currentBot,
  storage,
});

// ==================== Reminders API ====================

registerRemindersRoutes(app, { loadSettings, storage });

// ==================== Logs API ====================

registerLogsRoutes(app, { storage });

// ==================== AI Providers API ====================

registerAiProvidersRoutes(app, { loadSettings, saveSettings });

// ==================== Tools API ====================

registerToolsRoutes(app, { storage });

// ==================== Scheduled Tasks API ====================

registerScheduledTasksRoutes(app, {
  loadSettings,
  getScheduler: () => scheduler,
  getCurrentBot: () => currentBot,
  taskRegistry,
});

// ==================== Trending API ====================

registerTrendingRoutes(app, {
  loadSettings,
  getCurrentBot: () => currentBot,
  storage,
});

// ==================== Price Monitor API ====================

registerPriceMonitorRoutes(app, {
  loadSettings,
  getCurrentBot: () => currentBot,
  logger,
  storage,
});

// ==================== GitHub 监控 API ====================

githubRoutes = registerGithubRoutes(app, {
  loadSettings,
  getCurrentBot: () => currentBot,
  logger,
  storage,
});

// ==================== Stickers API ====================

stickersRoutes = registerStickersRoutes(app, {
  getDataPath,
  getCurrentBot: () => currentBot,
  loadSettings,
  logger,
  storage,
});

// ==================== Notes API ====================

registerNotesRoutes(app, { storage });

// ==================== Backup API ====================

backupRoutes = registerBackupRoutes(app, {
  loadSettings,
  saveSettings,
  getScheduler: () => scheduler,
  logger,
  storage,
  taskRegistry,
});

// ==================== 主函数 ====================

const PORT = process.env.PORT || 3001;
const server = http.createServer(app);
realtime = attachRealtime(server, { verifyToken, logger });

storage.events.on('log:add', log => {
  realtime?.broadcast({ type: 'log', data: log });
});

storage.events.on('log:clear', () => {
  realtime?.broadcast({ type: 'log', data: { cleared: true } });
});

storage.events.on('notification:add', notification => {
  realtime?.broadcast({ type: 'notification', data: notification });
});

taskRegistry.on('task:update', task => {
  realtime?.broadcast({ type: 'task_update', data: task });
  if (task.type === 'rss') {
    broadcastStatus();
  }
});

taskRegistry.on('task:remove', task => {
  realtime?.broadcast({ type: 'task_update', data: { ...task, removed: true } });
  broadcastStatus();
});

// SPA fallback - 必须放在所有 API 路由之后
if (fs.existsSync(publicPath)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });
}

server.listen(PORT, '0.0.0.0', async () => {
  logger.info(`🚀 Backend server running on port ${PORT}`);
  logger.info(`📋 Web Panel: http://localhost:${PORT}`);

  // 尝试启动 Bot
  try {
    await startBot();
  } catch (err) {
    logger.error(`初始启动失败: ${err.message}`);
  }

  // 启动定时备份
  backupRoutes?.startBackupScheduler();

  // 启动时清理一次贴纸缓存
  stickersRoutes?.cleanStickerCache();

  // 每 6 小时清理一次贴纸缓存
  setInterval(() => {
    stickersRoutes?.cleanStickerCache();
  }, 6 * 60 * 60 * 1000);
});

// 优雅退出
const stopSignals = ['SIGINT', 'SIGTERM'];
stopSignals.forEach(signal => {
  process.once(signal, async () => {
    logger.info('正在关闭服务...');
    realtime?.close();
    await stopBot(signal);
    await closeBrowser();
    process.exit(0);
  });
});
