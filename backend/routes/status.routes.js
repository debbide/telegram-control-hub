function registerStatusRoutes(app, { loadSettings, getCurrentBot, getScheduler }) {
  app.get('/api/status', (req, res) => {
    const settings = loadSettings();
    res.json({
      running: !!getCurrentBot(),
      configured: !!settings.botToken,
      subscriptions: getScheduler()?.getSubscriptions()?.length || 0,
    });
  });
}

module.exports = registerStatusRoutes;
