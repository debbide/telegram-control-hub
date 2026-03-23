/**
 * 设置管理
 */
const fs = require('fs');
const path = require('path');

const DATA_PATH = process.env.DATA_PATH || './data';
const SETTINGS_FILE = path.join(DATA_PATH, 'config.json');

// 默认设置
const DEFAULT_SETTINGS = {
  botToken: '',
  adminId: '',
  groupId: '',
  // AI 多配置支持
  aiProviders: [],        // AIProvider[] 数组: { id, name, apiKey, baseUrl, model, isActive }
  activeAiProvider: null, // 当前激活的配置 ID
  // 保留旧字段用于兼容迁移
  openaiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiModel: 'gpt-3.5-turbo',
  tgApiBase: '', // 可选的 Telegram API 代理
  webPort: 3001,
  logLevel: 'info',
  autoStart: true,
  notifications: true,
  rss: {
    checkInterval: 30, // 默认检查间隔(分钟)
    customBotToken: '', // 全局自定义 Bot Token
    customChatId: '',   // 全局自定义推送目标
    messageTemplate: '📰 <b>{feed_title}</b>\n{title}\n{link}', // 消息模板
    // 可用变量: {feed_title}, {title}, {link}, {description}, {date}
  },
  github: {
    checkInterval: 10, // 默认检查间隔(分钟)
  },
  features: {
    ai: true,
    rss: true,
    tools: true,
    reminders: true,
  },
  // WebDAV 备份配置
  webdav: {
    url: '',
    username: '',
    password: '',
    remotePath: '/tgbot-backup',
    autoBackup: false,
    autoBackupInterval: 24, // 小时
  },
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.mkdirSync(DATA_PATH, { recursive: true });
  }
}

function loadSettings() {
  ensureDataDir();
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('加载设置失败:', error.message);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  ensureDataDir();
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch (error) {
    console.error('保存设置失败:', error.message);
  }
}

function getDataPath() {
  return DATA_PATH;
}

// 获取当前激活的 AI 配置
function getActiveAiConfig(settings) {
  // 如果没有传入 settings，则加载
  const s = settings || loadSettings();

  // 优先使用多配置模式
  if (s.aiProviders?.length > 0 && s.activeAiProvider) {
    const active = s.aiProviders.find(p => p.id === s.activeAiProvider);
    if (active) {
      return {
        apiKey: active.apiKey,
        baseUrl: active.baseUrl,
        model: active.model,
        name: active.name,
      };
    }
  }
  // 兼容旧的单配置模式
  return {
    apiKey: s.openaiKey,
    baseUrl: s.openaiBaseUrl || 'https://api.openai.com/v1',
    model: s.openaiModel || 'gpt-3.5-turbo',
    name: '默认配置',
  };
}

module.exports = {
  loadSettings,
  saveSettings,
  getDataPath,
  getActiveAiConfig,
  DEFAULT_SETTINGS,
};
