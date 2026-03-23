/**
 * 启动和帮助命令 (交互式菜单版)
 */
const fs = require('fs');
const path = require('path');
const { loadSettings } = require('../settings');

const DATA_PATH = process.env.DATA_PATH || './data';
const RESTART_FLAG_FILE = path.join(DATA_PATH, 'restart_flag.json');

// 菜单定义
const MENUS = {
  main: {
    text: (ctx) => `👋 <b>你好，${ctx.from.first_name}！</b>\n\n欢迎使用控制面板，选择一个功能开始：`,
    buttons: [
      [
        { text: '📰 RSS 订阅', callback_data: 'menu_rss' },
        { text: '🎨 贴纸管理', callback_data: 'menu_stickers' },
      ],
      [
        { text: '⏰ 提醒事项', callback_data: 'menu_reminders' },
        { text: '🛠️ 实用工具', callback_data: 'menu_tools' },
      ],
      [
        { text: '🤖 AI 助手', callback_data: 'menu_ai' },
        { text: '⚙️ 系统设置', callback_data: 'menu_settings' },
      ],
      [{ text: '❓ 帮助信息', callback_data: 'menu_help' }],
    ],
  },
  tools: {
    text: '🛠️ <b>实用工具</b>\n\n常用命令速览：\n<code>/weather 城市</code>\n<code>/rate 100 USD CNY</code>\n<code>/qr 文本</code>\n<code>/short URL</code>\n<code>/ip IP地址</code>',
    buttons: [
      [
        { text: '🌐 翻译', callback_data: 'help_tr' },
        { text: '🔗 短链接', callback_data: 'help_short' },
      ],
      [
        { text: '📱 二维码', callback_data: 'help_qr' },
        { text: '🌤️ 天气', callback_data: 'help_weather' },
      ],
      [
        { text: '💰 汇率', callback_data: 'help_rate' },
        { text: '🆔 ID查询', callback_data: 'help_id' },
      ],
      [
        { text: '🌐 网络工具', callback_data: 'menu_network' },
      ],
      [{ text: '🔙 返回主菜单', callback_data: 'menu_main' }],
    ],
  },
  ai: {
    text: '🤖 <b>AI 助手</b>\n\n基于 OpenAI 的智能功能：',
    buttons: [
      [
        { text: '💬 聊天助手', callback_data: 'help_chat' },
        { text: '📝 智能摘要', callback_data: 'help_sum' },
      ],
      [{ text: '🔙 返回主菜单', callback_data: 'menu_main' }],
    ],
  },
  records: {
    text: '📝 <b>记录与提醒</b>\n\n管理你的待办和笔记：',
    buttons: [
      [
        { text: '⏰ 定时提醒', callback_data: 'help_remind' },
        { text: '📝 备忘录', callback_data: 'help_note' },
      ],
      [{ text: '🔙 返回主菜单', callback_data: 'menu_main' }],
    ],
  },
  rss: {
    text: '📰 <b>RSS 订阅</b>\n\n推荐流程：添加订阅 -> 查看列表 -> 调整关键词/间隔',
    buttons: [
      [
        { text: '➕ 添加订阅', callback_data: 'rss_add_prompt' },
        { text: '📋 查看列表', callback_data: 'rss_list_back' },
      ],
      [
        { text: '⚙️ 关键词说明', callback_data: 'help_rss_kw' },
        { text: '⏱️ 间隔说明', callback_data: 'help_rss_interval' },
      ],
      [{ text: '🔄 刷新全部', callback_data: 'rss_refresh_all' }],
      [{ text: '🔙 返回主菜单', callback_data: 'menu_main' }],
    ],
  },
  stickers: {
    text: '🎨 <b>贴纸管理</b>\n\n先发一张贴纸给我即可快速收藏或添加到贴纸包。',
    buttons: [
      [
        { text: '📋 我的收藏', callback_data: 'stickers_list' },
        { text: '📦 我的贴纸包', callback_data: 'mypack_list' },
      ],
      [
        { text: '➕ 新建贴纸包', callback_data: 'newpack_start' },
        { text: '📚 批量建包说明', callback_data: 'help_createpack' },
      ],
      [{ text: '🔙 返回主菜单', callback_data: 'menu_main' }],
    ],
  },
  reminders: {
    text: '⏰ <b>提醒事项</b>\n\n支持一次性、循环提醒，推荐先创建一个测试提醒。',
    buttons: [
      [
        { text: '➕ 添加提醒', callback_data: 'remind_add_prompt' },
        { text: '📋 提醒列表', callback_data: 'reminders_list' },
      ],
      [
        { text: '📝 用法说明', callback_data: 'help_remind' },
      ],
      [{ text: '🔙 返回主菜单', callback_data: 'menu_main' }],
    ],
  },
  network: {
    text: '🌐 <b>网络工具</b>\n\n网络诊断和查询：',
    buttons: [
      [
        { text: '🌍 IP 查询', callback_data: 'help_ip' },
        { text: '🔍 Whois', callback_data: 'help_whois' },
      ],
      [{ text: '🔙 返回主菜单', callback_data: 'menu_main' }],
    ],
  },
  settings: {
    text: (ctx) => {
      const settings = loadSettings();
      const admin = settings.adminId && ctx.from.id.toString() === settings.adminId;
      return `⚙️ <b>系统设置</b>\n\n请在浏览器中访问配置面板：\n<code>http://服务器IP:3001</code>${admin ? '\n\n👑 管理员可使用 /restart 重启 Bot' : ''}`;
    },
    buttons: (ctx) => {
      const settings = loadSettings();
      const admin = settings.adminId && ctx.from.id.toString() === settings.adminId;
      const buttons = [];
      if (admin) {
        buttons.push([{ text: '🔄 重启 Bot', callback_data: 'admin_restart' }]);
      }
      buttons.push([{ text: '🔙 返回主菜单', callback_data: 'menu_main' }]);
      return buttons;
    },
  },
  help: {
    text: '❓ <b>帮助信息</b>\n\n建议优先使用主菜单按钮操作。\n\n常用命令：\n<code>/start</code> 打开主菜单\n<code>/rss</code> 订阅管理\n<code>/stickers</code> 贴纸收藏\n<code>/reminders</code> 提醒列表',
    buttons: [
      [
        { text: '📚 RSS 帮助', callback_data: 'help_rss_add' },
        { text: '🎨 贴纸帮助', callback_data: 'help_createpack' },
      ],
      [{ text: '🔙 返回主菜单', callback_data: 'menu_main' }],
    ],
  },
};

// 帮助详情文案
const HELP_DETAILS = {
  help_tr: '🌐 <b>翻译</b>\n\n<code>/tr 文本</code> - 翻译到中文\n<code>/tr en 文本</code> - 翻译到指定语言',
  help_short: '🔗 <b>短链接</b>\n\n<code>/short URL</code> - 生成短链接',
  help_qr: '📱 <b>二维码</b>\n\n<code>/qr 内容</code> - 生成二维码',
  help_weather: '🌤️ <b>天气</b>\n\n<code>/weather 城市</code> - 查询天气',
  help_rate: '💰 <b>汇率</b>\n\n<code>/rate 100 USD CNY</code> - 汇率换算',
  help_id: '🆔 <b>ID查询</b>\n\n<code>/id</code> - 获取用户/群组 ID',
  help_chat: '💬 <b>聊天助手</b>\n\n<code>/chat 内容</code> - 与 AI 对话\n<code>/c 内容</code> - 简写\n<code>/chat clear</code> - 清除记忆',
  help_sum: '📝 <b>智能摘要</b>\n\n<code>/sum 链接/文本</code> - 生成摘要\n或回复消息发送 <code>/sum</code>',
  help_remind: '⏰ <b>提醒</b>\n\n<code>/remind 10m 开会</code> - 10分钟后\n<code>/remind 14:00 开会</code> - 指定时间\n<code>/reminders</code> - 查看列表',
  help_note: '📝 <b>备忘录</b>\n\n<code>/note 内容</code> - 添加\n<code>/notes</code> - 列表\n<code>/delnote ID</code> - 删除',
  help_createpack: '🎨 <b>贴纸包批量创建</b>\n\n<code>/createpack 名称</code> - 从收藏的静态贴纸批量创建贴纸包\n<code>/newpack 名称</code> - 先创建空贴纸包再逐个添加',
  help_rss_add: '📰 <b>添加订阅</b>\n\n<code>/rss add URL</code> - 添加订阅\n<code>/rss del ID</code> - 删除订阅',
  help_rss_list: '📰 <b>查看订阅</b>\n\n<code>/rss list</code> - 查看当前所有订阅',
  help_rss_kw: '📰 <b>关键词管理</b>\n\n<code>/rss kw add 词1,词2</code> - 添加白名单\n<code>/rss ex add 词1,词2</code> - 添加黑名单',
  help_rss_interval: '📰 <b>检查间隔</b>\n\n<code>/rss interval 30</code> - 设置检查间隔(分钟)',
  help_ip: '🌍 <b>IP 查询</b>\n\n<code>/ip 8.8.8.8</code> - 查询归属地',
  help_whois: '🔍 <b>Whois</b>\n\n<code>/whois example.com</code> - 域名信息',
};

function setup(bot, { isAdmin, logger }) {
  const sendMainMenu = (ctx) => {
    const menu = MENUS.main;
    return ctx.reply(menu.text(ctx), {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: menu.buttons },
    });
  };

  // /start 命令
  bot.command('start', (ctx) => {
    sendMainMenu(ctx);
  });

  // /menu 命令（主菜单快捷入口）
  bot.command('menu', (ctx) => {
    sendMainMenu(ctx);
  });

  // /help 命令
  bot.command('help', (ctx) => {
    sendMainMenu(ctx);
  });

  // 处理菜单点击
  bot.action(/^menu_(.+)$/, async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}

    const menuName = ctx.match[1];
    const menu = MENUS[menuName];
    if (!menu) return;

    const text = typeof menu.text === 'function' ? menu.text(ctx) : menu.text;
    const buttons = typeof menu.buttons === 'function' ? menu.buttons(ctx) : menu.buttons;

    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buttons },
      });
    } catch (e) {}
  });

  // 处理帮助详情点击
  bot.action(/^help_(.+)$/, async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}

    const helpKey = ctx.match[0];
    const text = HELP_DETAILS[helpKey];
    if (!text) return;

    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 返回主菜单', callback_data: 'menu_main' }]],
        },
      });
    } catch (e) {}
  });

  // 管理员重启
  bot.action('admin_restart', async (ctx) => {
    if (!isAdmin(ctx)) {
      return ctx.answerCbQuery('❌ 仅管理员可操作');
    }

    try {
      await ctx.answerCbQuery('🔄 正在重启...');
      await ctx.editMessageText('🔄 Bot 正在重启，请稍候...', { parse_mode: 'HTML' });

      setTimeout(() => {
        logger.info('🔄 管理员通过 Telegram 触发重启');
        process.exit(0);
      }, 1000);
    } catch (e) {
      logger.error(`重启操作失败: ${e.message}`);
    }
  });

  // /restart 命令
  bot.command('restart', async (ctx) => {
    if (!isAdmin(ctx)) {
      return ctx.reply('❌ 仅管理员可使用此命令');
    }

    await ctx.reply('🔄 Bot 正在重启，请稍候...');
    setTimeout(() => {
      logger.info('🔄 管理员通过 /restart 命令触发重启');
      process.exit(0);
    }, 1000);
  });

  logger.info('📋 Start/Help 命令已加载');
}

module.exports = { setup };
