const { Telegraf } = require('telegraf');

function registerRssRoutes(app, { loadSettings, parseRssFeed, getScheduler }) {
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

  app.get('/api/subscriptions', (req, res) => {
    const subscriptions = getScheduler()?.getSubscriptions() || [];
    res.json({ success: true, data: subscriptions });
  });

  app.post('/api/subscriptions', async (req, res) => {
    try {
      const { url, title, interval, keywords, enabled, chatId } = req.body;
      const settings = loadSettings();
      const scheduler = getScheduler();
      if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
      }
      if (!scheduler) {
        return res.status(503).json({ success: false, error: 'RSS 调度器未启动' });
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
        chatId: chatId || settings.adminId,
      });
      res.json({ success: true, data: subscription });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.put('/api/subscriptions/:id', (req, res) => {
    const subscription = getScheduler()?.updateSubscription(req.params.id, req.body);
    if (!subscription) {
      return res.status(404).json({ success: false, error: 'Subscription not found' });
    }
    res.json({ success: true, data: subscription });
  });

  app.delete('/api/subscriptions/:id', (req, res) => {
    const deleted = getScheduler()?.deleteSubscription(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Subscription not found' });
    }
    res.json({ success: true });
  });

  app.post('/api/subscriptions/refresh', async (req, res) => {
    await getScheduler()?.refreshAll();
    res.json({ success: true });
  });

  app.post('/api/bot/test', async (req, res) => {
    try {
      const { botToken, chatId } = req.body;
      const token = botToken || loadSettings().botToken;

      if (!token) {
        return res.status(400).json({ success: false, error: '未提供 Bot Token' });
      }

      const testBot = new Telegraf(token);
      const botInfo = await testBot.telegram.getMe();

      if (chatId) {
        await testBot.telegram.sendMessage(chatId, `✅ 测试成功！\n\n🤖 Bot: @${botInfo.username}\n📍 目标: ${chatId}\n⏱ 时间: ${new Date().toLocaleString('zh-CN')}`);
      }

      res.json({
        success: true,
        data: {
          username: botInfo.username,
          firstName: botInfo.first_name,
          messageSent: !!chatId,
        }
      });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  app.post('/api/subscriptions/:id/refresh', async (req, res) => {
    try {
      await getScheduler()?.refreshSubscription(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(404).json({ success: false, error: error.message });
    }
  });

  app.get('/api/subscriptions/history', (req, res) => {
    const history = getScheduler()?.getNewItemsHistory() || [];
    res.json({ success: true, data: history });
  });
}

module.exports = registerRssRoutes;
