const { WebSocketServer } = require('ws');
const { URL } = require('url');

function attachRealtime(server, { verifyToken, logger }) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();

  function send(ws, message) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        timestamp: new Date().toISOString(),
        ...message,
      }));
    }
  }

  function broadcast(message) {
    for (const client of clients) {
      send(client, message);
    }
  }

  server.on('upgrade', (request, socket, head) => {
    let url;
    try {
      url = new URL(request.url, 'http://localhost');
    } catch (error) {
      socket.destroy();
      return;
    }

    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const token = url.searchParams.get('token');
    if (!token || !verifyToken(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, ws => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', ws => {
    ws.isAlive = true;
    clients.add(ws);
    send(ws, { type: 'status', data: { connected: true } });

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('close', () => {
      clients.delete(ws);
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) {
        clients.delete(ws);
        ws.terminate();
        continue;
      }

      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);

  function close() {
    clearInterval(heartbeat);
    for (const client of clients) {
      client.close();
    }
    clients.clear();
    wss.close(error => {
      if (error) logger?.warn?.(`关闭 WebSocket 服务失败: ${error.message}`);
    });
  }

  return {
    broadcast,
    close,
    clientCount: () => clients.size,
  };
}

module.exports = attachRealtime;
