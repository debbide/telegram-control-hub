function registerMessageRoutes(app, { loadSettings, getCurrentBot }) {
  app.post('/api/send', async (req, res) => {
    try {
      const { chatId, text } = req.body;
      if (!chatId || !text) {
        return res.status(400).json({ success: false, error: '缺少 chatId 或 text' });
      }
      const currentBot = getCurrentBot();
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
      const currentBot = getCurrentBot();
      if (!currentBot) {
        return res.status(503).json({ success: false, error: 'Bot 未连接' });
      }
      const result = await currentBot.telegram.sendMessage(settings.adminId, text, { parse_mode: 'HTML' });
      res.json({ success: true, messageId: result.message_id });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = registerMessageRoutes;
