/**
 * 提醒命令 - 增强版（内联按钮管理）
 */
const fs = require('fs');
const path = require('path');

const DATA_PATH = process.env.DATA_PATH || './data';
const REMINDERS_FILE = path.join(DATA_PATH, 'reminders.json');

// 内存中的定时器
const timers = new Map();

function loadReminders() {
  try {
    if (fs.existsSync(REMINDERS_FILE)) {
      return JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf-8'));
    }
  } catch (e) {}
  return [];
}

function saveReminders(reminders) {
  try {
    if (!fs.existsSync(DATA_PATH)) {
      fs.mkdirSync(DATA_PATH, { recursive: true });
    }
    fs.writeFileSync(REMINDERS_FILE, JSON.stringify(reminders, null, 2));
  } catch (e) {}
}

function parseTimeString(timeStr) {
  const now = new Date();
  
  // 相对时间: 10m, 2h, 1d
  const relMatch = timeStr.match(/^(\d+)(m|h|d)$/i);
  if (relMatch) {
    const value = parseInt(relMatch[1]);
    const unit = relMatch[2].toLowerCase();
    const ms = unit === 'm' ? value * 60000 : unit === 'h' ? value * 3600000 : value * 86400000;
    return new Date(now.getTime() + ms);
  }
  
  // 绝对时间: 14:00
  const absMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (absMatch) {
    const target = new Date(now);
    target.setHours(parseInt(absMatch[1]), parseInt(absMatch[2]), 0, 0);
    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }
    return target;
  }
  
  return null;
}

function formatTimeRemaining(targetTime) {
  const now = Date.now();
  const target = new Date(targetTime).getTime();
  const diff = target - now;
  
  if (diff <= 0) return '即将触发';
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}天${hours % 24}小时后`;
  if (hours > 0) return `${hours}小时${minutes % 60}分钟后`;
  return `${minutes}分钟后`;
}

const PAGE_SIZE = 5;

function generateRemindersButtons(reminders, page = 0) {
  const totalPages = Math.ceil(reminders.length / PAGE_SIZE);
  const start = page * PAGE_SIZE;
  const pageReminders = reminders.slice(start, start + PAGE_SIZE);

  const buttons = pageReminders.map((r) => {
    const remaining = formatTimeRemaining(r.targetTime);
    return [
      { 
        text: `⏰ ${(r.message || '').substring(0, 20)} (${remaining})`, 
        callback_data: `remind_view_${r.id}` 
      },
      { text: '🗑️', callback_data: `remind_del_${r.id}` },
    ];
  });

  // 分页
  if (totalPages > 1) {
    const navRow = [];
    if (page > 0) {
      navRow.push({ text: '◀️ 上一页', callback_data: `reminders_page_${page - 1}` });
    }
    navRow.push({ text: `${page + 1}/${totalPages}`, callback_data: 'reminders_noop' });
    if (page < totalPages - 1) {
      navRow.push({ text: '下一页 ▶️', callback_data: `reminders_page_${page + 1}` });
    }
    buttons.push(navRow);
  }

  buttons.push([{ text: '➕ 添加提醒', callback_data: 'remind_add_prompt' }]);
  buttons.push([
    { text: '🔙 返回提醒菜单', callback_data: 'menu_reminders' },
    { text: '🏠 主菜单', callback_data: 'menu_main' },
  ]);

  return buttons;
}

function setup(bot, { logger }) {
  // 启动时恢复提醒
  const reminders = loadReminders();
  for (const reminder of reminders) {
    scheduleReminder(bot, reminder, logger);
  }
  logger.info(`⏰ 已恢复 ${reminders.length} 个提醒`);

  // /remind 命令
  bot.command('remind', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
      return ctx.reply(
        '⏰ <b>提醒助手</b>\n\n' +
        '<code>/remind 10m 开会</code> - 10分钟后\n' +
        '<code>/remind 2h 吃饭</code> - 2小时后\n' +
        '<code>/remind 1d 交报告</code> - 明天\n' +
        '<code>/remind 14:00 开会</code> - 指定时间\n\n' +
        '<code>/reminders</code> - 查看提醒列表',
        { 
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[
              { text: '📋 查看提醒列表', callback_data: 'reminders_list' }
            ], [
              { text: '🔙 返回提醒菜单', callback_data: 'menu_reminders' },
              { text: '🏠 主菜单', callback_data: 'menu_main' },
            ]]
          }
        }
      );
    }

    const timeStr = args[0];
    const message = args.slice(1).join(' ');
    const targetTime = parseTimeString(timeStr);

    if (!targetTime) {
      return ctx.reply('❌ 时间格式错误\n支持: 10m, 2h, 1d, 14:00');
    }

    const reminder = {
      id: `rem_${Date.now()}`,
      chatId: ctx.chat.id.toString(),
      userId: ctx.from.id.toString(),
      message,
      targetTime: targetTime.toISOString(),
      createdAt: new Date().toISOString(),
    };

    // 保存
    const reminders = loadReminders();
    reminders.push(reminder);
    saveReminders(reminders);

    // 设置定时器
    const delay = targetTime.getTime() - Date.now();
    const timer = setTimeout(async () => {
      try {
        await bot.telegram.sendMessage(
          reminder.chatId,
          `⏰ <b>提醒</b>\n\n${reminder.message}`,
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        logger.error(`发送提醒失败: ${e.message}`);
      }
      
      const current = loadReminders();
      saveReminders(current.filter(r => r.id !== reminder.id));
      timers.delete(reminder.id);
    }, delay);
    
    timers.set(reminder.id, timer);

    ctx.reply(
      `✅ <b>提醒已设置</b>\n\n` +
      `📝 ${message}\n` +
      `⏰ ${targetTime.toLocaleString('zh-CN')}\n` +
      `⏳ ${formatTimeRemaining(targetTime)}`,
      { 
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🗑️ 取消提醒', callback_data: `remind_del_${reminder.id}` },
              { text: '📋 查看全部', callback_data: 'reminders_list' },
            ]
          ]
        }
      }
    );
  });

  // /reminders 命令 - 查看提醒列表
  bot.command('reminders', (ctx) => {
    const userId = ctx.from.id.toString();
    const reminders = loadReminders().filter(r => r.userId === userId);

    if (reminders.length === 0) {
      return ctx.reply('📭 暂无提醒', {
        reply_markup: {
          inline_keyboard: [[{ text: '➕ 添加提醒', callback_data: 'remind_add_prompt' }]]
        }
      });
    }

    ctx.reply(
      `⏰ <b>提醒列表</b>\n\n📊 共 ${reminders.length} 个提醒`,
      { 
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: generateRemindersButtons(reminders, 0) }
      }
    );
  });

  // /delremind 命令 - 删除提醒
  bot.command('delremind', (ctx) => {
    const id = ctx.message.text.split(' ')[1];
    if (!id) {
      return ctx.reply('❌ 用法: /delremind <ID>');
    }

    deleteReminder(id);
    ctx.reply('✅ 提醒已删除');
  });

  // === 内联按钮回调 ===

  // 分页
  bot.action(/^reminders_page_(\d+)$/, async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    const page = parseInt(ctx.match[1]);
    const userId = ctx.from.id.toString();
    const reminders = loadReminders().filter(r => r.userId === userId);

    await ctx.editMessageText(
      `⏰ <b>提醒列表</b>\n\n📊 共 ${reminders.length} 个提醒`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: generateRemindersButtons(reminders, page) }
      }
    );
  });

  // 查看列表
  bot.action('reminders_list', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    const userId = ctx.from.id.toString();
    const reminders = loadReminders().filter(r => r.userId === userId);

    if (reminders.length === 0) {
      return ctx.editMessageText('📭 暂无提醒', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ 添加提醒', callback_data: 'remind_add_prompt' }],
            [
              { text: '🔙 返回提醒菜单', callback_data: 'menu_reminders' },
              { text: '🏠 主菜单', callback_data: 'menu_main' },
            ],
          ]
        }
      });
    }

    await ctx.editMessageText(
      `⏰ <b>提醒列表</b>\n\n📊 共 ${reminders.length} 个提醒`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: generateRemindersButtons(reminders, 0) }
      }
    );
  });

  // 查看详情
  bot.action(/^remind_view_(.+)$/, async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    const id = ctx.match[1];
    const reminder = loadReminders().find(r => r.id === id);

    if (!reminder) {
      return ctx.answerCbQuery('❌ 提醒不存在');
    }

    const targetTime = new Date(reminder.targetTime).toLocaleString('zh-CN');
    const remaining = formatTimeRemaining(reminder.targetTime);

    await ctx.editMessageText(
      `⏰ <b>提醒详情</b>\n\n` +
      `📝 ${reminder.message}\n\n` +
      `🕐 触发时间: ${targetTime}\n` +
      `⏳ 剩余: ${remaining}\n` +
      `🆔 ID: <code>${reminder.id}</code>`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🗑️ 删除', callback_data: `remind_del_confirm_${reminder.id}` },
              { text: '🔙 返回列表', callback_data: 'reminders_list' },
            ]
          ]
        }
      }
    );
  });

  // 删除确认
  bot.action(/^remind_del_confirm_(.+)$/, async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    const id = ctx.match[1];

    await ctx.editMessageText(
      '⚠️ <b>确认删除</b>\n\n确定要取消这个提醒吗？',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ 确认删除', callback_data: `remind_del_${id}` },
              { text: '❌ 取消', callback_data: `remind_view_${id}` },
            ]
          ]
        }
      }
    );
  });

  // 执行删除
  bot.action(/^remind_del_(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    const deleted = deleteReminder(id);

    if (!deleted) {
      return ctx.answerCbQuery('❌ 提醒不存在');
    }

    await ctx.answerCbQuery('✅ 已删除');

    // 返回列表
    const userId = ctx.from.id.toString();
    const reminders = loadReminders().filter(r => r.userId === userId);

    if (reminders.length === 0) {
      await ctx.editMessageText('📭 暂无提醒', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ 添加提醒', callback_data: 'remind_add_prompt' }],
            [
              { text: '🔙 返回提醒菜单', callback_data: 'menu_reminders' },
              { text: '🏠 主菜单', callback_data: 'menu_main' },
            ],
          ]
        }
      });
    } else {
      await ctx.editMessageText(
        `⏰ <b>提醒列表</b>\n\n📊 共 ${reminders.length} 个提醒`,
        {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: generateRemindersButtons(reminders, 0) }
        }
      );
    }
  });

  // 添加提示
  bot.action('remind_add_prompt', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch (e) {}
    await ctx.editMessageText(
      '➕ <b>添加提醒</b>\n\n' +
      '发送命令设置提醒：\n' +
      '<code>/remind 10m 内容</code> - 10分钟后\n' +
      '<code>/remind 2h 内容</code> - 2小时后\n' +
      '<code>/remind 14:00 内容</code> - 指定时间',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '🔙 返回提醒菜单', callback_data: 'menu_reminders' },
            { text: '🏠 主菜单', callback_data: 'menu_main' },
          ]],
        },
      }
    );
  });

  // 空操作
  bot.action('reminders_noop', (ctx) => ctx.answerCbQuery());

  logger.info('⏰ Remind 命令已加载');
}

// 删除提醒
function deleteReminder(id) {
  const reminders = loadReminders();
  const filtered = reminders.filter(r => r.id !== id);

  if (filtered.length === reminders.length) {
    return false;
  }

  saveReminders(filtered);

  // 取消定时器
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }

  return true;
}

// 调度提醒
function scheduleReminder(bot, reminder, logger) {
  const targetTime = new Date(reminder.targetTime);
  const delay = targetTime.getTime() - Date.now();

  if (delay > 0) {
    const timer = setTimeout(async () => {
      try {
        await bot.telegram.sendMessage(
          reminder.chatId,
          `⏰ <b>提醒时间到！</b>\n\n📝 ${reminder.message}`,
          { 
            parse_mode: 'HTML',
            reply_markup: {
              inline_keyboard: [[
                { text: '✅ 知道了', callback_data: 'remind_ack' }
              ]]
            }
          }
        );
      } catch (e) {
        logger.error(`发送提醒失败: ${e.message}`);
      }

      // 删除已触发的提醒
      const current = loadReminders();
      saveReminders(current.filter(r => r.id !== reminder.id));
      timers.delete(reminder.id);
    }, delay);

    timers.set(reminder.id, timer);
  }
}

module.exports = { setup };
