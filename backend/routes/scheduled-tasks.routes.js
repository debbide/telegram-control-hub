function mergeTaskState(task, taskRegistry) {
  const observed = taskRegistry?.getTask(task.id);
  if (!observed) return task;

  return {
    ...task,
    ...observed,
    name: task.name,
    description: task.description,
    interval: task.interval,
    type: task.type,
  };
}

function hasCompleteAutoBackupConfig(config = {}) {
  return !!(config.autoBackup && config.url && config.username && config.password);
}

function normalizeBackupTime(value) {
  if (typeof value !== 'string') return '03:00';
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value) ? value : '03:00';
}

function getNextScheduledBackupDate(config = {}, from = new Date()) {
  const [hours, minutes] = normalizeBackupTime(config.autoBackupTime).split(':').map(Number);
  const nextRun = new Date(from);
  nextRun.setHours(hours, minutes, 0, 0);
  if (nextRun <= from) {
    nextRun.setDate(nextRun.getDate() + 1);
  }
  return nextRun;
}

function registerScheduledTasksRoutes(app, { loadSettings, getScheduler, getCurrentBot, taskRegistry }) {
  app.get('/api/scheduled-tasks', (req, res) => {
    const settings = loadSettings();
    const tasks = [];

    const subscriptions = getScheduler()?.getSubscriptions() || [];
    for (const sub of subscriptions) {
      if (sub.enabled) {
        const lastCheck = sub.lastCheck ? new Date(sub.lastCheck) : null;
        const intervalMs = (sub.interval || 30) * 60 * 1000;
        const nextCheck = lastCheck ? new Date(lastCheck.getTime() + intervalMs) : new Date();

        tasks.push({
          id: `rss_${sub.id}`,
          type: 'rss',
          name: `RSS: ${sub.title}`,
          description: `检查订阅 "${sub.title}"`,
          interval: `${sub.interval} 分钟`,
          lastRun: sub.lastCheck || null,
          nextRun: nextCheck.toISOString(),
          status: sub.lastError ? 'error' : 'active',
          error: sub.lastError || null,
        });
      }
    }

    tasks.push({
      id: 'reminder_check',
      type: 'system',
      name: '提醒检查器',
      description: '检查并发送到期的提醒',
      interval: '1 分钟',
      lastRun: null,
      nextRun: null,
      status: settings.features?.reminders && getCurrentBot?.() ? 'active' : 'paused',
      error: null,
    });

    const webdavConfig = settings.webdav || {};
    if (hasCompleteAutoBackupConfig(webdavConfig)) {
      tasks.push({
        id: 'webdav_backup',
        type: 'backup',
        name: 'WebDAV 自动备份',
        description: '备份数据到 WebDAV 服务器',
        interval: `每天 ${normalizeBackupTime(webdavConfig.autoBackupTime)}`,
        lastRun: null,
        nextRun: getNextScheduledBackupDate(webdavConfig).toISOString(),
        status: 'active',
        error: null,
      });
    }

    res.json({ success: true, data: tasks.map(task => mergeTaskState(task, taskRegistry)) });
  });

  app.get('/api/scheduled-tasks/:id/history', (req, res) => {
    res.json({ success: true, data: taskRegistry?.getRecentRuns(req.params.id) || [] });
  });
}

module.exports = registerScheduledTasksRoutes;
