function registerNotificationsRoutes(app, { loadSettings, getCurrentBot, storage }) {
  app.get('/api/notifications', (req, res) => {
    res.json({ success: true, data: storage.getNotifications() });
  });

  app.post('/api/notifications/:id/read', (req, res) => {
    const notification = storage.markNotificationRead(req.params.id);
    if (!notification) {
      return res.status(404).json({ success: false, error: '通知不存在' });
    }
    res.json({ success: true, data: notification });
  });

  app.post('/api/notifications/read-all', (req, res) => {
    res.json({ success: true, data: storage.markAllNotificationsRead() });
  });

  app.delete('/api/notifications/:id', (req, res) => {
    const deleted = storage.deleteNotification(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: '通知不存在' });
    }
    res.json({ success: true });
  });

  app.delete('/api/notifications', (req, res) => {
    storage.clearNotifications();
    res.json({ success: true });
  });

  app.post('/api/notifications/test', async (req, res) => {
    try {
      const settings = loadSettings();
      const currentBot = getCurrentBot();
      if (!settings.adminId || !currentBot) {
        const notification = storage.addNotification({
          type: 'error',
          title: '测试通知失败',
          message: 'Bot 未连接或未配置管理员 ID',
        });
        return res.status(400).json({ success: false, error: 'Bot 未连接或未配置管理员 ID', data: notification });
      }

      await currentBot.telegram.sendMessage(settings.adminId, '🔔 这是一条来自 Web 面板的测试通知');
      const notification = storage.addNotification({
        type: 'system',
        title: '测试通知',
        message: '这是一条来自 Web 面板的测试通知',
      });
      res.json({ success: true, data: notification });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = registerNotificationsRoutes;
