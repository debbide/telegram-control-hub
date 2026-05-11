function registerToolsRoutes(app, { storage }) {
  app.get('/api/tools', (req, res) => {
    const tools = storage.getTools();
    res.json({ success: true, data: tools });
  });

  app.put('/api/tools/:id', (req, res) => {
    const tool = storage.updateTool(req.params.id, req.body);
    if (!tool) {
      return res.status(404).json({ success: false, error: '工具不存在' });
    }
    res.json({ success: true, data: tool });
  });

  app.post('/api/tools/:id/toggle', (req, res) => {
    const { enabled } = req.body;
    const tool = storage.updateTool(req.params.id, { enabled });
    if (!tool) {
      return res.status(404).json({ success: false, error: '工具不存在' });
    }
    res.json({ success: true, data: tool });
  });

  app.get('/api/tools/stats', (req, res) => {
    const tools = storage.getTools();
    const stats = tools.map(t => ({ command: t.command, count: t.usage || 0 }));
    res.json({ success: true, data: stats });
  });
}

module.exports = registerToolsRoutes;
