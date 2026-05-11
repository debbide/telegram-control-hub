const DEFAULT_ADMIN = { username: 'admin', password: 'admin' };

const authTokens = new Map();

const publicPaths = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/verify',
  '/api/health',
];

const publicPathPrefixes = [
  '/api/stickers/preview/',
];

function verifyToken(token) {
  return authTokens.get(token) || null;
}

function authMiddleware(req, res, next) {
  if (publicPaths.includes(req.path)) {
    return next();
  }

  if (publicPathPrefixes.some(prefix => req.path.startsWith(prefix))) {
    return next();
  }

  if (!req.path.startsWith('/api')) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, error: '未登录，请先登录' });
  }

  const token = authHeader.replace('Bearer ', '');
  const user = verifyToken(token);

  if (!user) {
    return res.status(401).json({ success: false, error: '登录已过期，请重新登录' });
  }

  req.user = user;
  next();
}

function registerAuthRoutes(app, { loadSettings, saveSettings }) {
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const settings = loadSettings();

    const adminUser = settings.webUser || DEFAULT_ADMIN.username;
    const adminPass = settings.webPassword || DEFAULT_ADMIN.password;

    if (username === adminUser && password === adminPass) {
      const token = `token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      authTokens.set(token, { username, isAdmin: true });
      res.json({
        success: true,
        data: {
          token,
          user: { username, isAdmin: true }
        }
      });
    } else {
      res.status(401).json({ success: false, error: '用户名或密码错误' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      authTokens.delete(token);
    }
    res.json({ success: true });
  });

  app.get('/api/auth/verify', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.json({ valid: false });
    }

    const token = authHeader.replace('Bearer ', '');
    const user = verifyToken(token);
    if (user) {
      res.json({ valid: true, user });
    } else {
      res.json({ valid: false });
    }
  });

  app.post('/api/auth/change-password', (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const settings = loadSettings();
    const currentPassword = settings.webPassword || DEFAULT_ADMIN.password;

    if (oldPassword !== currentPassword) {
      return res.status(401).json({ success: false, error: '旧密码错误' });
    }

    settings.webPassword = newPassword;
    saveSettings(settings);
    res.json({ success: true });
  });
}

module.exports = {
  DEFAULT_ADMIN,
  authMiddleware,
  registerAuthRoutes,
  verifyToken,
};
