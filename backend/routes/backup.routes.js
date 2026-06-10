const webdav = require('../webdav');

const TASK_ID = 'webdav_backup';

function registerBackupRoutes(app, { loadSettings, saveSettings, getScheduler, logger, storage, taskRegistry }) {
  let backupTimer = null;

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

  function getBackupIntervalLabel(config = {}) {
    return `每天 ${normalizeBackupTime(config.autoBackupTime)}`;
  }

  function createBackupData(settings) {
    return {
      timestamp: new Date().toISOString(),
      version: '1.0',
      config: { ...settings, webdav: { ...settings.webdav, password: '***' } },
      notes: storage.getNotes(),
      reminders: storage.getReminders(),
      stats: storage.getStats(),
      tools: storage.getTools(),
      subscriptions: getScheduler()?.getSubscriptions() || [],
    };
  }

  async function uploadBackup(config, backupData) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const remotePath = `${config.remotePath || '/tgbot-backup'}/backup_${timestamp}.json`;
    const content = JSON.stringify(backupData, null, 2);
    const result = await webdav.uploadFile(config, remotePath, content);
    return { result, remotePath };
  }

  async function cleanOldBackups(config) {
    try {
      const remotePath = config.remotePath || '/tgbot-backup';
      const result = await webdav.listFiles(config, remotePath);

      if (!result.success || !result.data) return;

      const now = new Date();
      const maxAge = 3 * 24 * 60 * 60 * 1000;

      for (const file of result.data) {
        if (file.modified) {
          const fileDate = new Date(file.modified);
          if (now - fileDate > maxAge) {
            logger.info(`🗑️ 清理过期备份: ${file.name}`);
            await webdav.deleteFile(config, file.path);
            storage.addLog('info', `清理过期备份: ${file.name}`, 'backup');
          }
        }
      }
    } catch (error) {
      logger.error(`清理备份失败: ${error.message}`);
    }
  }

  function getNextRun(config) {
    return getNextScheduledBackupDate(config).toISOString();
  }

  async function runAutoBackup() {
    const settings = loadSettings();
    const config = settings.webdav || {};

    if (!hasCompleteAutoBackupConfig(config)) {
      return;
    }

    const startedAt = new Date().toISOString();
    taskRegistry?.markRunStart(TASK_ID, {
      type: 'backup',
      name: 'WebDAV 自动备份',
      description: '备份数据到 WebDAV 服务器',
      interval: getBackupIntervalLabel(config),
      nextRun: getNextRun(config),
    });

    logger.info('⏰ 执行定时 WebDAV 备份...');

    try {
      const backupData = createBackupData(settings);
      const { result, remotePath } = await uploadBackup(config, backupData);

      if (result.success) {
        logger.info(`✅ 定时备份成功: ${remotePath}`);
        storage.addLog('info', `定时备份成功: ${remotePath}`, 'backup');
        storage.addNotification({
          type: 'system',
          title: '自动备份成功',
          message: remotePath,
        });
        taskRegistry?.markRunSuccess(TASK_ID, {
          startedAt,
          nextRun: getNextRun(config),
        });
        await cleanOldBackups(config);
      } else {
        logger.error(`❌ 定时备份失败: ${result.error}`);
        storage.addLog('error', `定时备份失败: ${result.error}`, 'backup');
        storage.addNotification({
          type: 'error',
          title: '自动备份失败',
          message: result.error || 'WebDAV 备份失败',
        });
        taskRegistry?.markRunError(TASK_ID, new Error(result.error || 'WebDAV 备份失败'), {
          startedAt,
          nextRun: getNextRun(config),
        });
      }
    } catch (error) {
      logger.error(`❌ 定时备份异常: ${error.message}`);
      storage.addLog('error', `定时备份异常: ${error.message}`, 'backup');
      storage.addNotification({
        type: 'error',
        title: '自动备份异常',
        message: error.message,
      });
      taskRegistry?.markRunError(TASK_ID, error, {
        startedAt,
        nextRun: getNextRun(config),
      });
    } finally {
      startBackupScheduler();
    }
  }

  function startBackupScheduler() {
    if (backupTimer) {
      clearTimeout(backupTimer);
      backupTimer = null;
    }
    const settings = loadSettings();
    const config = settings.webdav || {};

    if (hasCompleteAutoBackupConfig(config)) {
      const nextRun = getNextScheduledBackupDate(config);
      const delayMs = Math.max(nextRun.getTime() - Date.now(), 1000);
      logger.info(`📅 启动定时备份，时间: ${normalizeBackupTime(config.autoBackupTime)}`);
      taskRegistry?.upsertTask(TASK_ID, {
        type: 'backup',
        name: 'WebDAV 自动备份',
        description: '备份数据到 WebDAV 服务器',
        interval: getBackupIntervalLabel(config),
        status: 'active',
        error: null,
        nextRun: nextRun.toISOString(),
      });
      backupTimer = setTimeout(runAutoBackup, delayMs);
    } else {
      taskRegistry?.removeTask(TASK_ID);
    }
  }

  app.get('/api/backup', (req, res) => {
    try {
      const backupFile = storage.createBackup();
      res.download(backupFile);
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/backup/webdav/test', async (req, res) => {
    const settings = loadSettings();
    const config = settings.webdav || {};

    if (!config.url || !config.username || !config.password) {
      return res.status(400).json({ success: false, error: '请先配置 WebDAV 连接信息' });
    }

    const result = await webdav.testConnection(config);
    res.json(result);
  });

  app.post('/api/backup/webdav/upload', async (req, res) => {
    try {
      const settings = loadSettings();
      const config = settings.webdav || {};

      if (!config.url || !config.username || !config.password) {
        return res.status(400).json({ success: false, error: '请先配置 WebDAV 连接信息' });
      }

      const backupData = createBackupData(settings);
      const { result, remotePath } = await uploadBackup(config, backupData);

      if (result.success) {
        storage.addLog('info', `WebDAV 备份成功: ${remotePath}`, 'backup');
        storage.addNotification({
          type: 'system',
          title: '手动备份成功',
          message: remotePath,
        });
        res.json({ success: true, message: '备份成功', path: remotePath });
      } else {
        storage.addNotification({
          type: 'error',
          title: '手动备份失败',
          message: result.error || 'WebDAV 备份失败',
        });
        res.json(result);
      }
    } catch (error) {
      storage.addNotification({
        type: 'error',
        title: '手动备份异常',
        message: error.message,
      });
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/backup/webdav/list', async (req, res) => {
    const settings = loadSettings();
    const config = settings.webdav || {};

    if (!config.url) {
      return res.json({ success: true, data: [] });
    }

    const remotePath = config.remotePath || '/tgbot-backup';
    const result = await webdav.listFiles(config, remotePath);
    res.json(result);
  });

  app.post('/api/backup/webdav/restore', async (req, res) => {
    try {
      const { path: remotePath } = req.body;
      const settings = loadSettings();
      const config = settings.webdav || {};

      if (!remotePath) {
        return res.status(400).json({ success: false, error: '请指定备份文件路径' });
      }

      const result = await webdav.downloadFile(config, remotePath);

      if (!result.success) {
        return res.json(result);
      }

      const backupData = JSON.parse(result.data);

      if (backupData.config) {
        const currentWebdav = settings.webdav;
        const newSettings = { ...settings, ...backupData.config, webdav: currentWebdav };
        saveSettings(newSettings);
      }

      storage.addLog('info', `从 WebDAV 恢复备份: ${remotePath}`, 'backup');
      res.json({ success: true, message: '恢复成功，请重启 Bot 使配置生效' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete('/api/backup/webdav/:filename', async (req, res) => {
    const settings = loadSettings();
    const config = settings.webdav || {};
    const remotePath = `${config.remotePath || '/tgbot-backup'}/${req.params.filename}`;

    const result = await webdav.deleteFile(config, remotePath);
    res.json(result);
  });

  return { startBackupScheduler };
}

module.exports = registerBackupRoutes;
