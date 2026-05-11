function registerLogsRoutes(app, { storage }) {
  app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const logs = storage.getLogs().slice(-limit).reverse();
    res.json({ success: true, data: logs });
  });

  app.delete('/api/logs', (req, res) => {
    storage.clearLogs();
    res.json({ success: true });
  });
}

module.exports = registerLogsRoutes;
