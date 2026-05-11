const trending = require('../trending');

function registerTrendingRoutes(app, { loadSettings, getCurrentBot, storage }) {
  let trendingCache = {};
  let trendingCacheTime = null;
  const TRENDING_CACHE_TTL = 5 * 60 * 1000;

  app.get('/api/trending/sources', (req, res) => {
    res.json({
      success: true,
      data: Object.values(trending.TRENDING_SOURCES),
    });
  });

  app.get('/api/trending/:source', async (req, res) => {
    const { source } = req.params;

    if (!trending.TRENDING_SOURCES[source]) {
      return res.status(404).json({ success: false, error: '不支持的热榜源' });
    }

    try {
      const now = Date.now();
      if (
        trendingCache[source] &&
        trendingCacheTime &&
        now - trendingCacheTime < TRENDING_CACHE_TTL
      ) {
        return res.json({ success: true, data: trendingCache[source], cached: true });
      }

      const items = await trending.fetchTrending(source);
      trendingCache[source] = {
        ...trending.TRENDING_SOURCES[source],
        items,
        updatedAt: new Date().toISOString(),
      };
      trendingCacheTime = now;

      res.json({ success: true, data: trendingCache[source] });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/trending', async (req, res) => {
    try {
      const now = Date.now();
      if (
        Object.keys(trendingCache).length > 0 &&
        trendingCacheTime &&
        now - trendingCacheTime < TRENDING_CACHE_TTL
      ) {
        return res.json({ success: true, data: trendingCache, cached: true });
      }

      const data = await trending.fetchAllTrending();
      trendingCache = data;
      trendingCacheTime = now;

      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/trending/:source/push', async (req, res) => {
    const { source } = req.params;
    const { limit = 10 } = req.body;

    if (!trending.TRENDING_SOURCES[source]) {
      return res.status(404).json({ success: false, error: '不支持的热榜源' });
    }

    const currentBot = getCurrentBot();
    if (!currentBot) {
      return res.status(503).json({ success: false, error: 'Bot 未运行' });
    }

    try {
      const items = await trending.fetchTrending(source);
      const message = trending.formatTrendingMessage(source, items, limit);

      if (!message) {
        return res.status(500).json({ success: false, error: '获取热榜数据失败' });
      }

      const settings = loadSettings();
      const chatId = settings.adminId;

      if (!chatId) {
        return res.status(400).json({ success: false, error: '未配置管理员 ID' });
      }

      await currentBot.telegram.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });

      storage.addLog('info', `推送热榜: ${trending.TRENDING_SOURCES[source].name}`, 'trending');
      res.json({ success: true, message: '推送成功' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
}

module.exports = registerTrendingRoutes;
