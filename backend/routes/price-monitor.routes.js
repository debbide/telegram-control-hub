const PriceMonitor = require('../price-monitor');

function registerPriceMonitorRoutes(app, { loadSettings, getCurrentBot, logger, storage }) {
  let priceMonitor = null;

  function initPriceMonitor() {
    if (priceMonitor) return priceMonitor;

    priceMonitor = new PriceMonitor(logger, async (data) => {
      const currentBot = getCurrentBot();
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
    return priceMonitor;
  }

  setTimeout(initPriceMonitor, 3000);

  app.get('/api/price-monitors', (req, res) => {
    const monitor = initPriceMonitor();
    const items = monitor.getItems();
    res.json({ success: true, data: items });
  });

  app.get('/api/price-monitors/:id', (req, res) => {
    const monitor = initPriceMonitor();
    const items = monitor.getItems();
    const item = items.find(i => i.id === req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, error: '监控项不存在' });
    }
    res.json({ success: true, data: item });
  });

  app.get('/api/price-monitors/:id/history', (req, res) => {
    const monitor = initPriceMonitor();
    const history = monitor.getHistory(req.params.id);
    res.json({ success: true, data: history });
  });

  app.post('/api/price-monitors', (req, res) => {
    const monitor = initPriceMonitor();
    const { url, selector, name, interval, targetPrice, notifyOnAnyChange, notifyOnDrop, dropThreshold } = req.body;

    if (!url || !selector) {
      return res.status(400).json({ success: false, error: '请提供商品链接和价格选择器' });
    }

    try {
      const item = monitor.addItem({
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

  app.put('/api/price-monitors/:id', (req, res) => {
    const monitor = initPriceMonitor();
    const item = monitor.updateItem(req.params.id, req.body);
    if (!item) {
      return res.status(404).json({ success: false, error: '监控项不存在' });
    }
    res.json({ success: true, data: item });
  });

  app.delete('/api/price-monitors/:id', (req, res) => {
    const monitor = initPriceMonitor();
    const deleted = monitor.deleteItem(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: '监控项不存在' });
    }
    res.json({ success: true });
  });

  app.post('/api/price-monitors/:id/refresh', async (req, res) => {
    const monitor = initPriceMonitor();
    try {
      const item = await monitor.refreshItem(req.params.id);
      res.json({ success: true, data: item });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/price-monitors/test', async (req, res) => {
    const monitor = initPriceMonitor();
    const { url, selector } = req.body;

    if (!url || !selector) {
      return res.status(400).json({ success: false, error: '请提供商品链接和价格选择器' });
    }

    try {
      const price = await monitor.fetchPrice(url, selector);
      if (price === null) {
        return res.json({ success: false, error: '无法提取价格，请检查选择器是否正确' });
      }
      res.json({ success: true, data: { price } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return { initPriceMonitor };
}

module.exports = registerPriceMonitorRoutes;
