function registerRemindersRoutes(app, { loadSettings, storage }) {
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
    const chatId = userId;

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
}

module.exports = registerRemindersRoutes;
