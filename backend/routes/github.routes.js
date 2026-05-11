const GitHubMonitor = require('../github-monitor');

const githubHeaders = {
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'TG-Bot-GitHub-Monitor',
};

function parseRepoPath(repoPath) {
  let fullName = repoPath;
  const urlMatch = repoPath.match(/github\.com\/([^\/]+)\/([^\/\s]+)/);
  if (urlMatch) {
    fullName = `${urlMatch[1]}/${urlMatch[2]}`;
  }

  const parts = fullName.split('/');
  if (parts.length !== 2) {
    return null;
  }

  return parts;
}

function registerGithubRoutes(app, { loadSettings, getCurrentBot, logger, storage }) {
  let githubMonitor = null;

  function initGithubMonitor() {
    if (githubMonitor) return githubMonitor;
    const currentBot = getCurrentBot();
    if (!currentBot) {
      logger.warn('GitHub 监控器初始化失败: Bot 未启动');
      return null;
    }

    githubMonitor = new GitHubMonitor(logger, async (data) => {
      const bot = getCurrentBot();
      if (!bot) return;

      const settings = loadSettings();
      if (!settings.adminId) return;

      try {
        const message = githubMonitor.formatMessage(data);
        await bot.telegram.sendMessage(settings.adminId, message, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
      } catch (error) {
        logger.error(`推送 GitHub 通知失败: ${error.message}`);
        storage.addLog('error', `推送 GitHub 通知失败: ${error.message}`, 'github');
      }
    });

    githubMonitor.start();
    return githubMonitor;
  }

  app.get('/api/github/repos', (req, res) => {
    const repos = storage.getGithubRepos();
    res.json({ success: true, data: repos });
  });

  app.get('/api/github/repos/:id', (req, res) => {
    const repos = storage.getGithubRepos();
    const repo = repos.find(r => r.id === req.params.id);

    if (!repo) {
      return res.status(404).json({ success: false, error: '仓库不存在' });
    }

    res.json({ success: true, data: repo });
  });

  app.post('/api/github/repos', async (req, res) => {
    const { repo: repoPath, watchTypes } = req.body;

    if (!repoPath) {
      return res.status(400).json({ success: false, error: '请提供仓库地址' });
    }

    const parts = parseRepoPath(repoPath);
    if (!parts) {
      return res.status(400).json({ success: false, error: '仓库格式错误，正确格式: owner/repo' });
    }

    const [owner, repo] = parts;

    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: githubHeaders,
      });

      if (response.status === 404) {
        return res.status(404).json({ success: false, error: '仓库不存在' });
      }

      if (!response.ok) {
        return res.status(500).json({ success: false, error: `GitHub API 错误: ${response.status}` });
      }

      const repoInfo = await response.json();
      const types = watchTypes || ['release'];
      const result = storage.addGithubRepo(owner, repo, types);

      if (result.success) {
        storage.addLog('info', `GitHub 添加监控: ${owner}/${repo}`, 'github');
        res.json({
          success: true,
          data: {
            ...result.data,
            repoInfo: {
              description: repoInfo.description,
              stars: repoInfo.stargazers_count,
              forks: repoInfo.forks_count,
              language: repoInfo.language,
            },
          },
        });
      } else {
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.put('/api/github/repos/:id', (req, res) => {
    const { watchTypes } = req.body;
    const updated = storage.updateGithubRepo(req.params.id, { watchTypes });

    if (updated) {
      res.json({ success: true, data: updated });
    } else {
      res.status(404).json({ success: false, error: '仓库不存在' });
    }
  });

  app.delete('/api/github/repos/:id', (req, res) => {
    const deleted = storage.deleteGithubRepo(req.params.id);

    if (deleted) {
      storage.addLog('info', `GitHub 取消监控: ${req.params.id}`, 'github');
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: '仓库不存在' });
    }
  });

  app.post('/api/github/repos/:id/refresh', async (req, res) => {
    const monitor = initGithubMonitor();
    if (!monitor) {
      return res.status(503).json({ success: false, error: 'Bot 未启动' });
    }

    try {
      await monitor.refreshRepo(req.params.id);
      const repos = storage.getGithubRepos();
      const repo = repos.find(r => r.id === req.params.id);
      res.json({ success: true, data: repo });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/github/refresh-all', async (req, res) => {
    const monitor = initGithubMonitor();
    if (!monitor) {
      return res.status(503).json({ success: false, error: 'Bot 未启动' });
    }

    try {
      await monitor.checkAll();
      res.json({ success: true, message: '刷新完成' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/github/accounts', (req, res) => {
    const accounts = storage.getGithubOwners();
    res.json({ success: true, data: accounts });
  });

  app.post('/api/github/accounts', async (req, res) => {
    const owner = String(req.body?.owner || '').trim();
    const ownerTypeInput = String(req.body?.ownerType || 'auto').toLowerCase();

    if (!owner) {
      return res.status(400).json({ success: false, error: '请提供 GitHub 账号' });
    }

    try {
      const response = await fetch(`https://api.github.com/users/${owner}`, {
        headers: githubHeaders,
      });

      if (response.status === 404) {
        return res.status(404).json({ success: false, error: 'GitHub 账号不存在' });
      }

      if (!response.ok) {
        return res.status(500).json({ success: false, error: `GitHub API 错误: ${response.status}` });
      }

      const profile = await response.json();
      const detectedType = profile.type === 'Organization' ? 'org' : 'user';
      const ownerType = ownerTypeInput === 'auto' ? detectedType : ownerTypeInput;

      if (!['user', 'org'].includes(ownerType)) {
        return res.status(400).json({ success: false, error: '账号类型仅支持 user 或 org' });
      }

      const result = storage.addGithubOwner(owner, ownerType);
      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error });
      }

      storage.addLog('info', `GitHub 添加账号监控: ${owner} (${ownerType})`, 'github');
      res.json({
        success: true,
        data: {
          ...result.data,
          profile: {
            login: profile.login,
            type: profile.type,
            publicRepos: profile.public_repos,
            url: profile.html_url,
          },
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete('/api/github/accounts/:id', (req, res) => {
    const deleted = storage.deleteGithubOwner(req.params.id);

    if (deleted) {
      storage.addLog('info', `GitHub 取消账号监控: ${req.params.id}`, 'github');
      res.json({ success: true });
    } else {
      res.status(404).json({ success: false, error: '账号监控不存在' });
    }
  });

  app.post('/api/github/accounts/:id/refresh', async (req, res) => {
    const monitor = initGithubMonitor();
    if (!monitor) {
      return res.status(503).json({ success: false, error: 'Bot 未启动' });
    }

    try {
      const account = await monitor.refreshOwner(req.params.id);
      res.json({ success: true, data: account });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/github/notifications', (req, res) => {
    const notifications = storage.getGithubNotifications();
    res.json({ success: true, data: notifications });
  });

  app.get('/api/github/search', async (req, res) => {
    const { repo } = req.query;

    if (!repo) {
      return res.status(400).json({ success: false, error: '请提供仓库地址' });
    }

    let fullName = repo;
    const urlMatch = repo.match(/github\.com\/([^\/]+)\/([^\/\s]+)/);
    if (urlMatch) {
      fullName = `${urlMatch[1]}/${urlMatch[2]}`;
    }

    try {
      const response = await fetch(`https://api.github.com/repos/${fullName}`, {
        headers: githubHeaders,
      });

      if (!response.ok) {
        return res.status(404).json({ success: false, error: '仓库不存在' });
      }

      const repoInfo = await response.json();
      let latestRelease = null;
      try {
        const releaseRes = await fetch(`https://api.github.com/repos/${fullName}/releases/latest`, {
          headers: githubHeaders,
        });
        if (releaseRes.ok) {
          latestRelease = await releaseRes.json();
        }
      } catch {}

      res.json({
        success: true,
        data: {
          fullName: repoInfo.full_name,
          description: repoInfo.description,
          stars: repoInfo.stargazers_count,
          forks: repoInfo.forks_count,
          watchers: repoInfo.watchers_count,
          language: repoInfo.language,
          url: repoInfo.html_url,
          latestRelease: latestRelease ? {
            tag: latestRelease.tag_name,
            name: latestRelease.name,
            publishedAt: latestRelease.published_at,
            url: latestRelease.html_url,
          } : null,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return {
    initGithubMonitor,
    getGithubMonitor: () => githubMonitor,
  };
}

module.exports = registerGithubRoutes;
