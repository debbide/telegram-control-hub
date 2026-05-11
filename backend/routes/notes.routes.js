function registerNotesRoutes(app, { storage }) {
  app.get('/api/notes', (req, res) => {
    const notes = storage.getNotes();
    res.json({ success: true, data: notes });
  });

  app.post('/api/notes', (req, res) => {
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ success: false, error: '内容不能为空' });
    }
    const note = storage.addNote(content);
    res.json({ success: true, data: note });
  });

  app.put('/api/notes/:id', (req, res) => {
    const note = storage.updateNote(req.params.id, req.body);
    if (!note) {
      return res.status(404).json({ success: false, error: '笔记不存在' });
    }
    res.json({ success: true, data: note });
  });

  app.delete('/api/notes/:id', (req, res) => {
    const deleted = storage.deleteNote(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: '笔记不存在' });
    }
    res.json({ success: true });
  });
}

module.exports = registerNotesRoutes;
