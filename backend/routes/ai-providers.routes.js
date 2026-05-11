function registerAiProvidersRoutes(app, { loadSettings, saveSettings }) {
  app.get('/api/ai-providers', (req, res) => {
    const settings = loadSettings();
    const providers = (settings.aiProviders || []).map(p => ({
      ...p,
      apiKey: p.apiKey ? '***已配置***' : '',
      isActive: p.id === settings.activeAiProvider,
    }));
    res.json({ success: true, data: providers });
  });

  app.post('/api/ai-providers', (req, res) => {
    const { name, apiKey, baseUrl, model } = req.body;
    if (!name || !apiKey || !baseUrl) {
      return res.status(400).json({ success: false, error: '名称、API Key 和 Base URL 不能为空' });
    }

    const settings = loadSettings();
    if (!settings.aiProviders) {
      settings.aiProviders = [];
    }

    const newProvider = {
      id: `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      apiKey,
      baseUrl,
      model: model || 'gpt-3.5-turbo',
    };

    settings.aiProviders.push(newProvider);

    if (settings.aiProviders.length === 1) {
      settings.activeAiProvider = newProvider.id;
    }

    saveSettings(settings);
    res.json({
      success: true,
      data: {
        ...newProvider,
        apiKey: '***已配置***',
        isActive: newProvider.id === settings.activeAiProvider,
      }
    });
  });

  app.put('/api/ai-providers/:id', (req, res) => {
    const { id } = req.params;
    const { name, apiKey, baseUrl, model } = req.body;

    const settings = loadSettings();
    const index = (settings.aiProviders || []).findIndex(p => p.id === id);

    if (index === -1) {
      return res.status(404).json({ success: false, error: '配置不存在' });
    }

    if (name) settings.aiProviders[index].name = name;
    if (apiKey) settings.aiProviders[index].apiKey = apiKey;
    if (baseUrl) settings.aiProviders[index].baseUrl = baseUrl;
    if (model) settings.aiProviders[index].model = model;

    saveSettings(settings);
    res.json({
      success: true,
      data: {
        ...settings.aiProviders[index],
        apiKey: '***已配置***',
        isActive: settings.aiProviders[index].id === settings.activeAiProvider,
      }
    });
  });

  app.delete('/api/ai-providers/:id', (req, res) => {
    const { id } = req.params;
    const settings = loadSettings();

    const index = (settings.aiProviders || []).findIndex(p => p.id === id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: '配置不存在' });
    }

    if (id === settings.activeAiProvider && settings.aiProviders.length > 1) {
      return res.status(400).json({ success: false, error: '不能删除当前激活的配置，请先切换到其他配置' });
    }

    settings.aiProviders.splice(index, 1);

    if (id === settings.activeAiProvider) {
      settings.activeAiProvider = settings.aiProviders[0]?.id || null;
    }

    saveSettings(settings);
    res.json({ success: true });
  });

  app.post('/api/ai-providers/:id/activate', (req, res) => {
    const { id } = req.params;
    const settings = loadSettings();

    const provider = (settings.aiProviders || []).find(p => p.id === id);
    if (!provider) {
      return res.status(404).json({ success: false, error: '配置不存在' });
    }

    settings.activeAiProvider = id;
    saveSettings(settings);
    res.json({ success: true, message: `已切换到: ${provider.name}` });
  });
}

module.exports = registerAiProvidersRoutes;
