const { Telegraf } = require('telegraf');
const RssScheduler = require('./scheduler');

function createBotManager({
  loadSettings,
  saveSettings,
  loadCommands,
  parseRssFeed,
  storage,
  logger,
  taskRegistry,
  getBot,
  setBot,
  getScheduler,
  setScheduler,
  onStatusChange = () => {},
  onRssUpdate = () => {},
}) {
  let reminderTimer = null;

  function stopReminderTimer() {
    if (reminderTimer) {
      clearInterval(reminderTimer);
      reminderTimer = null;
    }
  }

  async function checkReminders(bot) {
    const startedAt = new Date().toISOString();
    const settings = loadSettings();
    taskRegistry?.upsertTask('reminder_check', {
      type: 'system',
      name: '提醒检查器',
      description: '检查并发送到期的提醒',
      interval: '1 分钟',
      status: settings.features?.reminders ? 'running' : 'paused',
      lastRun: startedAt,
      nextRun: new Date(Date.now() + 60000).toISOString(),
    });

    if (!settings.features.reminders) return;

    const reminders = storage.getReminders();
    const now = new Date();

    const pendingReminders = reminders.filter(r => {
      const time = r.targetTime || r.triggerAt;
      return r.status === 'pending' && new Date(time) <= now;
    });

    let failed = null;

    for (const reminder of pendingReminders) {
      try {
        const targetChatId = reminder.chatId || settings.adminId;

        if (targetChatId) {
          const content = reminder.message || reminder.content;
          await bot.telegram.sendMessage(targetChatId, `⏰ <b>提醒</b>\n\n${content}`, { parse_mode: 'HTML' });
          storage.addLog('info', `触发提醒: ${content}`, 'reminder');
          storage.addNotification({
            type: 'reminder',
            title: '提醒已触发',
            message: content,
          });

          if (reminder.repeat === 'daily') {
            const time = reminder.targetTime || reminder.triggerAt;
            const nextTime = new Date(time);
            nextTime.setDate(nextTime.getDate() + 1);

            storage.updateReminder(reminder.id, {
              targetTime: nextTime.toISOString(),
              triggerAt: nextTime.toISOString()
            });
          } else {
            storage.updateReminder(reminder.id, { status: 'completed' });
          }
        }
      } catch (e) {
        failed = e;
        storage.addLog('error', `提醒发送失败: ${e.message}`, 'reminder');
        storage.addNotification({
          type: 'error',
          title: '提醒发送失败',
          message: e.message,
        });
      }
    }

    if (failed) {
      taskRegistry?.markRunError('reminder_check', failed, {
        startedAt,
        nextRun: new Date(Date.now() + 60000).toISOString(),
      });
    } else {
      taskRegistry?.markRunSuccess('reminder_check', {
        startedAt,
        nextRun: new Date(Date.now() + 60000).toISOString(),
      });
    }
  }

  async function stopBot(reason) {
    stopReminderTimer();

    const scheduler = getScheduler();
    if (scheduler) {
      scheduler.stopAll();
      setScheduler(null);
      onStatusChange({ running: false, subscriptions: 0 });
    }

    const currentBot = getBot();
    if (currentBot) {
      await currentBot.stop(reason);
      setBot(null);
      onStatusChange({ running: false });
    }
  }

  async function startBot() {
    const existingBot = getBot();
    if (existingBot) {
      try {
        await stopBot();
        logger.info('🛑 旧 Bot 实例已停止');
      } catch (e) {
        logger.error(`停止旧实例失败: ${e.message}`);
        setBot(null);
      }
    }

    let settings = loadSettings();
    const maskedSecretValue = '***已配置***';

    if (settings.botToken === maskedSecretValue) {
      logger.warn('⚠️ 检测到无效的 botToken 掩码值，已视为未配置');
      settings.botToken = '';
    }

    if (!settings.botToken && process.env.BOT_TOKEN) {
      settings.botToken = process.env.BOT_TOKEN;
      settings.adminId = process.env.ADMIN_ID || settings.adminId;
      saveSettings(settings);
      logger.info('📝 已从环境变量导入初始配置到 config.json');
    }

    if (!settings.botToken) {
      logger.warn('❌ 未配置 Bot Token，请在面板中配置');
      onStatusChange({ running: false, configured: false });
      return;
    }

    const botOptions = {};
    if (settings.tgApiBase) {
      botOptions.telegram = { apiRoot: settings.tgApiBase };
    }
    const bot = new Telegraf(settings.botToken, botOptions);

    const isAdmin = (ctx) => {
      if (!settings.adminId) return false;
      return String(ctx.from?.id) === String(settings.adminId);
    };

    const scheduler = new RssScheduler(parseRssFeed, logger, async (subscription, newItems) => {
      const currentSettings = loadSettings();
      const globalRss = currentSettings.rss || {};

      let targetToken = null;
      let targetChatId = null;
      let botLabel = '系统 Bot';

      if (subscription.useCustomPush && subscription.customBotToken) {
        targetToken = subscription.customBotToken;
        targetChatId = subscription.customChatId || subscription.chatId;
        botLabel = '订阅独立 Bot';
      } else if (globalRss.customBotToken) {
        targetToken = globalRss.customBotToken;
        targetChatId = globalRss.customChatId || subscription.chatId;
        botLabel = '全局 RSS Bot';
      } else {
        targetChatId = subscription.chatId;
      }

      if (!targetChatId) {
        logger.warn(`[${subscription.title}] 无推送目标，跳过`);
        return;
      }

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
      } else if (getBot()) {
        telegramApi = getBot().telegram;
      } else {
        logger.warn(`[${subscription.title}] 系统 Bot 未就绪，跳过推送`);
        return;
      }

      for (const item of newItems.slice(0, 5)) {
        try {
          const template = globalRss.messageTemplate || '📰 <b>{feed_title}</b>\n{title}\n{link}';
          const message = template
            .replace(/{feed_title}/g, subscription.title || '')
            .replace(/{title}/g, item.title || '')
            .replace(/{link}/g, item.link || '')
            .replace(/{description}/g, (item.description || '').substring(0, 200))
            .replace(/{date}/g, item.pubDate ? new Date(item.pubDate).toLocaleString('zh-CN') : '');

          await telegramApi.sendMessage(targetChatId, message, {
            parse_mode: 'HTML',
            disable_web_page_preview: false,
          });
          storage.addLog('info', `[${botLabel}] 推送: [${subscription.title}] ${item.title}`, 'rss');
        } catch (e) {
          logger.error(`推送失败: ${e.message}`);
          storage.addLog('error', `[${botLabel}] 推送失败: ${e.message}`, 'rss');
        }
      }

      const currentScheduler = getScheduler();
      for (const item of newItems) {
        currentScheduler?.saveNewItemToHistory(subscription, item);
      }

      onRssUpdate({
        subscription: {
          id: subscription.id,
          title: subscription.title,
          url: subscription.url,
        },
        items: newItems,
      });
      storage.addNotification({
        type: 'rss',
        title: 'RSS 发现新内容',
        message: `${subscription.title} 发现 ${newItems.length} 条新内容`,
      });
    }, taskRegistry);

    setScheduler(scheduler);
    loadCommands(bot, { isAdmin, scheduler, logger, settings });
    setBot(bot);

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
        storage.addNotification({
          type: 'system',
          title: 'Bot 启动成功',
          message: `@${botInfo.username} 已开始运行`,
        });
        onStatusChange({
          running: true,
          configured: true,
          subscriptions: scheduler.getSubscriptions().length,
        });

        scheduler.startAll();

        stopReminderTimer();
        reminderTimer = setInterval(() => checkReminders(bot), 60000);
        checkReminders(bot);

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
    storage.addNotification({
      type: 'error',
      title: 'Bot 启动失败',
      message: '已达到最大重试次数',
    });
    onStatusChange({ running: false, configured: true });
  }

  return {
    checkReminders,
    startBot,
    stopBot,
    stopReminderTimer,
  };
}

module.exports = createBotManager;
