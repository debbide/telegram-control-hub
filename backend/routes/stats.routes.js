function registerStatsRoutes(app, { storage, getCurrentBot, getScheduler }) {
  app.get('/api/stats', (req, res) => {
    const stats = storage.getStats();
    const reminders = storage.getReminders();
    const notes = storage.getNotes();
    const today = new Date().toISOString().split('T')[0];
    const todayStats = stats.dailyStats?.[today] || { total: 0 };

    const commandStats = Object.entries(stats.commandCounts || {}).map(([cmd, count]) => ({
      command: cmd,
      label: cmd.replace('/', ''),
      count,
      icon: '📊',
    })).sort((a, b) => b.count - a.count).slice(0, 6);

    const commandTrend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayStats = stats.dailyStats?.[dateStr] || { total: 0 };
      commandTrend.push({
        date: `${d.getMonth() + 1}-${d.getDate()}`,
        total: dayStats.total || 0,
      });
    }

    res.json({
      success: true,
      data: {
        online: !!getCurrentBot(),
        uptime: process.uptime() > 3600
          ? `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`
          : `${Math.floor(process.uptime() / 60)}m`,
        memory: Math.round((process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100),
        lastRestart: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        totalCommands: stats.totalCommands || 0,
        commandsToday: todayStats.total || 0,
        aiTokensUsed: stats.aiTokensUsed || 0,
        rssFeeds: getScheduler()?.getSubscriptions()?.length || 0,
        pendingReminders: reminders.filter(r => r.status === 'pending').length,
        activeNotes: notes.filter(n => !n.completed).length,
        commandStats,
        commandTrend,
        recentActivity: [],
      }
    });
  });
}

module.exports = registerStatsRoutes;
