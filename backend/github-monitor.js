/**
 * GitHub 仓库监控模块
 * 定期检查仓库更新，推送通知
 */
const storage = require('./storage');
const { loadSettings } = require('./settings');

class GitHubMonitor {
  constructor(logger, onUpdate) {
    this.logger = logger;
    this.onUpdate = onUpdate;
    this.timer = null;
    this.checkInterval = 10 * 60 * 1000; // 默认 10 分钟检查一次
    this.updateCheckIntervalFromSettings(loadSettings());
  }

  normalizeIntervalMinutes(rawValue) {
    const num = Number(rawValue);
    if (!Number.isFinite(num)) return 10;
    const rounded = Math.round(num);
    if (rounded < 1) return 1;
    if (rounded > 1440) return 1440;
    return rounded;
  }

  updateCheckIntervalFromSettings(settings) {
    const minutes = this.normalizeIntervalMinutes(settings?.github?.checkInterval ?? 10);
    this.checkInterval = minutes * 60 * 1000;
    return minutes;
  }

  updateCheckInterval(minutes) {
    const normalized = this.normalizeIntervalMinutes(minutes);
    this.checkInterval = normalized * 60 * 1000;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = setInterval(() => {
        this.checkAll();
      }, this.checkInterval);
    }

    this.logger.info(`🐙 GitHub 监控间隔已更新: ${normalized} 分钟`);
    return normalized;
  }

  /**
   * 启动监控
   */
  start() {
    if (this.timer) {
      this.stop();
    }

    const currentMinutes = this.updateCheckIntervalFromSettings(loadSettings());
    this.logger.info(`🐙 启动 GitHub 仓库监控 (间隔 ${currentMinutes} 分钟)`);

    // 延迟 30 秒后首次检查（避免启动时压力过大）
    setTimeout(() => {
      this.checkAll();
    }, 30000);

    // 定时检查
    this.timer = setInterval(() => {
      this.checkAll();
    }, this.checkInterval);
  }

  async checkAll() {
    await this.checkAllRepos();
    await this.checkAllOwners();
  }

  /**
   * 停止监控
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('⏹️ 停止 GitHub 仓库监控');
    }
  }

  /**
   * 检查所有仓库
   */
  async checkAllRepos() {
    const repos = storage.getGithubRepos();

    if (repos.length === 0) {
      return;
    }

    this.logger.info(`🔄 检查 ${repos.length} 个 GitHub 仓库...`);

    for (const repo of repos) {
      try {
        await this.checkRepo(repo);
        // 避免请求过快，间隔 2 秒
        await this.sleep(2000);
      } catch (error) {
        this.logger.error(`检查 ${repo.fullName} 失败: ${error.message}`);
        storage.addLog('error', `GitHub 检查失败: ${repo.fullName} - ${error.message}`, 'github');
      }
    }
  }

  async checkAllOwners() {
    const owners = storage.getGithubOwners();

    if (owners.length === 0) {
      return;
    }

    this.logger.info(`🔄 检查 ${owners.length} 个 GitHub 账号...`);

    for (const ownerMonitor of owners) {
      try {
        await this.checkOwner(ownerMonitor);
        await this.sleep(2000);
      } catch (error) {
        this.logger.error(`检查账号 ${ownerMonitor.owner} 失败: ${error.message}`);
        storage.addLog('error', `GitHub 账号检查失败: ${ownerMonitor.owner} - ${error.message}`, 'github');
      }
    }
  }

  /**
   * 检查单个仓库
   */
  async checkRepo(repo) {
    const { owner, repo: repoName, watchTypes, fullName } = repo;

    // 检查 Release
    if (watchTypes.includes('release')) {
      await this.checkRelease(repo);
    }

    // 检查 Star 数（可选）
    if (watchTypes.includes('star')) {
      await this.checkStars(repo);
    }

    // 更新最后检查时间
    storage.updateGithubRepo(repo.id, {
      lastCheck: new Date().toISOString(),
    });
  }

  /**
   * 检查新 Release
   */
  async checkRelease(repo) {
    const { owner, repo: repoName, fullName, lastRelease } = repo;

    try {
      const release = await this.fetchLatestRelease(owner, repoName);

      if (!release) {
        return; // 没有 Release
      }

      // 首次检查，记录当前版本但不通知
      if (!lastRelease) {
        storage.updateGithubRepo(repo.id, {
          lastRelease: {
            tag: release.tag_name,
            publishedAt: release.published_at,
          },
        });
        this.logger.info(`  📌 ${fullName}: 首次记录版本 ${release.tag_name}`);
        return;
      }

      // 检查是否有新版本
      if (release.tag_name !== lastRelease.tag) {
        this.logger.info(`  🚀 ${fullName}: 发现新版本 ${release.tag_name}`);

        // 更新记录
        storage.updateGithubRepo(repo.id, {
          lastRelease: {
            tag: release.tag_name,
            publishedAt: release.published_at,
          },
        });

        // 保存通知
        storage.addGithubNotification(fullName, 'release', {
          tag: release.tag_name,
          name: release.name,
          body: release.body,
          url: release.html_url,
          publishedAt: release.published_at,
        });

        // 发送通知
        if (this.onUpdate) {
          await this.onUpdate({
            type: 'release',
            repo: fullName,
            release: {
              tag: release.tag_name,
              name: release.name || release.tag_name,
              body: release.body,
              url: release.html_url,
              publishedAt: release.published_at,
            },
          });
        }

        storage.addLog('info', `GitHub 新版本: ${fullName} ${release.tag_name}`, 'github');
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * 检查 Star 数变化
   */
  async checkStars(repo) {
    const { owner, repo: repoName, fullName, lastStar } = repo;

    try {
      const repoInfo = await this.fetchRepoInfo(owner, repoName);

      if (!repoInfo) {
        return;
      }

      const currentStars = repoInfo.stargazers_count;

      // 首次记录
      if (lastStar === null || lastStar === undefined) {
        storage.updateGithubRepo(repo.id, { lastStar: currentStars });
        this.logger.info(`  ⭐ ${fullName}: 首次记录 Star ${currentStars}`);
        return;
      }

      // 检查里程碑（每 100、500、1000... 通知）
      const milestones = [100, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
      for (const m of milestones) {
        if (lastStar < m && currentStars >= m) {
          this.logger.info(`  🌟 ${fullName}: Star 突破 ${m}！`);

          storage.addGithubNotification(fullName, 'star_milestone', {
            milestone: m,
            currentStars,
            url: repoInfo.html_url,
          });

          if (this.onUpdate) {
            await this.onUpdate({
              type: 'star_milestone',
              repo: fullName,
              milestone: m,
              currentStars,
              url: repoInfo.html_url,
            });
          }

          storage.addLog('info', `GitHub Star 里程碑: ${fullName} 突破 ${m}`, 'github');
          break;
        }
      }

      // 更新记录
      storage.updateGithubRepo(repo.id, { lastStar: currentStars });
    } catch (error) {
      throw error;
    }
  }

  /**
   * 获取最新 Release
   */
  async fetchLatestRelease(owner, repo) {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const response = await this.fetchWithHeaders(url);

    if (response.status === 404) {
      return null; // 没有 Release
    }

    if (!response.ok) {
      throw new Error(`GitHub API 错误: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * 获取仓库信息
   */
  async fetchRepoInfo(owner, repo) {
    const url = `https://api.github.com/repos/${owner}/${repo}`;
    const response = await this.fetchWithHeaders(url);

    if (!response.ok) {
      throw new Error(`GitHub API 错误: ${response.status}`);
    }

    return await response.json();
  }

  async fetchOwnerRepos(owner, ownerType = 'user') {
    const repos = [];
    const endpointPrefix = ownerType === 'org' ? 'orgs' : 'users';

    for (let page = 1; page <= 3; page++) {
      const url = `https://api.github.com/${endpointPrefix}/${owner}/repos?type=public&sort=pushed&direction=desc&per_page=100&page=${page}`;
      const response = await this.fetchWithHeaders(url);

      if (response.status === 404) {
        throw new Error('GitHub 账号不存在');
      }

      if (!response.ok) {
        throw new Error(`GitHub API 错误: ${response.status}`);
      }

      const pageRepos = await response.json();
      repos.push(...pageRepos);

      if (pageRepos.length < 100) {
        break;
      }
    }

    return repos;
  }

  async checkOwner(ownerMonitor) {
    const { id, owner, ownerType = 'user', repoSnapshots = [] } = ownerMonitor;
    const repos = await this.fetchOwnerRepos(owner, ownerType);

    const latestSnapshots = repos.map((repo) => ({
      fullName: repo.full_name,
      pushedAt: repo.pushed_at,
      htmlUrl: repo.html_url,
    }));

    const currentSnapshotMap = new Map(latestSnapshots.map((r) => [r.fullName, r]));
    const previousSnapshotMap = new Map((repoSnapshots || []).map((r) => [r.fullName, r]));

    const now = new Date().toISOString();

    // 首次记录快照，不推送
    if (!repoSnapshots || repoSnapshots.length === 0) {
      storage.updateGithubOwner(id, {
        repoSnapshots: latestSnapshots,
        lastCheck: now,
      });
      this.logger.info(`  📌 ${owner}: 首次记录 ${latestSnapshots.length} 个仓库快照`);
      return;
    }

    const updatedRepos = [];
    for (const [fullName, current] of currentSnapshotMap.entries()) {
      const previous = previousSnapshotMap.get(fullName);
      if (!previous) {
        updatedRepos.push(current);
        continue;
      }
      if (current.pushedAt && previous.pushedAt && new Date(current.pushedAt).getTime() > new Date(previous.pushedAt).getTime()) {
        updatedRepos.push(current);
      }
    }

    storage.updateGithubOwner(id, {
      repoSnapshots: latestSnapshots,
      lastCheck: now,
    });

    if (updatedRepos.length === 0) {
      return;
    }

    const previewRepos = updatedRepos.slice(0, 8).map((r) => ({
      fullName: r.fullName,
      pushedAt: r.pushedAt,
      htmlUrl: r.htmlUrl,
    }));

    this.logger.info(`  🔔 ${owner}: 发现 ${updatedRepos.length} 个仓库更新`);

    storage.addGithubNotification(owner, 'owner_repo_update', {
      owner,
      ownerType,
      updatedCount: updatedRepos.length,
      repos: previewRepos,
      profileUrl: `https://github.com/${owner}`,
      url: `https://github.com/${owner}`,
    });

    if (this.onUpdate) {
      await this.onUpdate({
        type: 'owner_repo_update',
        owner,
        ownerType,
        updatedCount: updatedRepos.length,
        repos: previewRepos,
        profileUrl: `https://github.com/${owner}`,
      });
    }

    storage.addLog('info', `GitHub 账号更新: ${owner} (${updatedRepos.length} 个仓库)`, 'github');
  }

  /**
   * 带认证头的请求
   */
  async fetchWithHeaders(url) {
    const settings = loadSettings();
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'TG-Bot-GitHub-Monitor',
    };

    // 如果配置了 GitHub Token，添加认证头
    if (settings.githubToken) {
      headers['Authorization'] = `token ${settings.githubToken}`;
    }

    return await fetch(url, { headers });
  }

  /**
   * 手动刷新单个仓库
   */
  async refreshRepo(repoId) {
    const repos = storage.getGithubRepos();
    const repo = repos.find(r => r.id === repoId);

    if (!repo) {
      throw new Error('仓库不存在');
    }

    await this.checkRepo(repo);
    return repo;
  }

  async refreshOwner(ownerId) {
    const owners = storage.getGithubOwners();
    const owner = owners.find(o => o.id === ownerId);

    if (!owner) {
      throw new Error('账号不存在');
    }

    await this.checkOwner(owner);
    return storage.getGithubOwners().find(o => o.id === ownerId) || owner;
  }

  /**
   * 获取仓库详情（含实时信息）
   */
  async getRepoDetails(owner, repo) {
    const repoInfo = await this.fetchRepoInfo(owner, repo);
    let latestRelease = null;

    try {
      latestRelease = await this.fetchLatestRelease(owner, repo);
    } catch (e) {
      // 可能没有 release
    }

    return {
      ...repoInfo,
      latestRelease,
    };
  }

  /**
   * 格式化通知消息
   */
  formatMessage(data) {
    if (data.type === 'release') {
      const { repo, release } = data;
      const body = release.body
        ? release.body.substring(0, 500) + (release.body.length > 500 ? '...' : '')
        : '无更新说明';

      return [
        `🚀 <b>新版本发布</b>`,
        ``,
        `📦 <b>${repo}</b>`,
        `🏷️ ${release.tag}`,
        release.name !== release.tag ? `📝 ${release.name}` : '',
        ``,
        `<b>更新内容：</b>`,
        `<code>${this.escapeHtml(body)}</code>`,
        ``,
        `🔗 <a href="${release.url}">查看详情</a>`,
      ].filter(Boolean).join('\n');
    }

    if (data.type === 'star_milestone') {
      return [
        `🌟 <b>Star 里程碑</b>`,
        ``,
        `📦 <b>${data.repo}</b>`,
        `⭐ 突破 <b>${data.milestone}</b> Star！`,
        `📊 当前 Star 数: ${data.currentStars}`,
        ``,
        `🔗 <a href="${data.url}">查看仓库</a>`,
      ].join('\n');
    }

    if (data.type === 'owner_repo_update') {
      const repoLines = (data.repos || []).slice(0, 6).map((repo, idx) => {
        const updatedAt = repo.pushedAt ? new Date(repo.pushedAt).toLocaleString('zh-CN') : '未知时间';
        return `${idx + 1}. <a href="${repo.htmlUrl}">${repo.fullName}</a>\n   🕒 ${updatedAt}`;
      });

      const extraLine = data.updatedCount > 6
        ? `\n... 以及另外 ${data.updatedCount - 6} 个仓库更新`
        : '';

      return [
        `📡 <b>账号仓库有更新</b>`,
        ``,
        `👤 <b>${data.owner}</b>`,
        `📦 本轮更新: <b>${data.updatedCount}</b> 个仓库`,
        ``,
        `<b>更新仓库：</b>`,
        repoLines.join('\n'),
        extraLine,
        ``,
        `🔗 <a href="${data.profileUrl}">查看账号主页</a>`,
      ].filter(Boolean).join('\n');
    }

    return '';
  }

  escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = GitHubMonitor;
