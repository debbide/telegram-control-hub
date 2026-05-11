/**
 * WebDAV 备份服务
 * 支持坚果云、Alist 等 WebDAV 服务
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * WebDAV 请求封装
 */
async function webdavRequest(config, method, remotePath, body = null, timeoutOverride = null) {
    const { url, username, password, timeout = 120000 } = config;
    const requestTimeout = timeoutOverride || timeout;
    const baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    const fullUrl = `${baseUrl}${remotePath}`;

    const urlObj = new URL(fullUrl);
    const isHttps = urlObj.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const auth = Buffer.from(`${username}:${password}`).toString('base64');

    const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method,
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/octet-stream',
        },
    };

    if (body) {
        options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    return new Promise((resolve, reject) => {
        const req = httpModule.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    data,
                });
            });
        });

        req.on('error', reject);
        req.setTimeout(requestTimeout, () => {
            req.destroy(new Error(`${method} ${remotePath} 请求超时（${Math.round(requestTimeout / 1000)} 秒）`));
        });

        if (body) {
            req.write(body);
        }
        req.end();
    });
}

/**
 * 测试 WebDAV 连接
 */
async function testConnection(config) {
    try {
        const result = await webdavRequest(config, 'PROPFIND', '/', null, 30000);

        if (result.status === 401) {
            return { success: false, error: '认证失败，请检查用户名和密码' };
        }
        if (!result.ok && result.status !== 207) {
            return { success: false, error: `连接失败: HTTP ${result.status}` };
        }

        const remotePath = config.remotePath || '/tgbot-backup';
        const testPath = `${remotePath}/connection_test_${Date.now()}.txt`;
        const uploadResult = await uploadFile(config, testPath, 'webdav connection test');

        if (!uploadResult.success) {
            return { success: false, error: `连接成功，但备份目录写入失败: ${uploadResult.error}` };
        }

        await deleteFile(config, testPath);
        return { success: true, message: '连接成功，备份目录可写' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * 确保远程目录存在（递归创建）
 */
async function ensureDir(config, remotePath) {
    if (!remotePath || remotePath === '/') return true;

    const existing = await webdavRequest(config, 'PROPFIND', remotePath, null, 30000);
    if (existing.ok || existing.status === 207) return true;

    const parts = remotePath.split('/').filter(p => p);
    let currentPath = '';

    for (const part of parts) {
        currentPath += '/' + part;
        const result = await webdavRequest(config, 'MKCOL', currentPath, null, 30000);
        if (result.status !== 201 && result.status !== 405) {
            return { success: false, error: `创建目录失败: ${currentPath} HTTP ${result.status}` };
        }
    }
    return true;
}

/**
 * 上传文件到 WebDAV
 */
async function uploadFile(config, remotePath, content) {
    try {
        // 确保备份目录存在（提取目录部分）
        const lastSlash = remotePath.lastIndexOf('/');
        if (lastSlash > 0) {
            const dir = remotePath.substring(0, lastSlash);
            const dirResult = await ensureDir(config, dir);
            if (dirResult !== true) return dirResult;
        }

        const result = await webdavRequest(config, 'PUT', remotePath, content);

        if (result.ok || result.status === 201 || result.status === 204) {
            return { success: true };
        } else {
            return { success: false, error: `上传失败: HTTP ${result.status}` };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * 从 WebDAV 下载文件
 */
async function downloadFile(config, remotePath) {
    try {
        const result = await webdavRequest(config, 'GET', remotePath);

        if (result.ok) {
            return { success: true, data: result.data };
        } else if (result.status === 404) {
            return { success: false, error: '文件不存在' };
        } else {
            return { success: false, error: `下载失败: HTTP ${result.status}` };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * 列出 WebDAV 目录中的文件
 */
async function listFiles(config, remotePath = '/') {
    try {
        const result = await webdavRequest(config, 'PROPFIND', remotePath);

        if (!result.ok && result.status !== 207) {
            return { success: false, error: `列出文件失败: HTTP ${result.status}` };
        }

        // 简单解析 XML 响应获取文件列表
        const files = [];
        const hrefRegex = /<d:href>([^<]+)<\/d:href>/gi;
        const displayRegex = /<d:displayname>([^<]*)<\/d:displayname>/gi;
        const modifiedRegex = /<d:getlastmodified>([^<]*)<\/d:getlastmodified>/gi;
        const sizeRegex = /<d:getcontentlength>([^<]*)<\/d:getcontentlength>/gi;

        let match;
        const hrefs = [];
        const displays = [];
        const modifieds = [];
        const sizes = [];

        while ((match = hrefRegex.exec(result.data)) !== null) {
            hrefs.push(decodeURIComponent(match[1]));
        }
        while ((match = displayRegex.exec(result.data)) !== null) {
            displays.push(match[1]);
        }
        while ((match = modifiedRegex.exec(result.data)) !== null) {
            modifieds.push(match[1]);
        }
        while ((match = sizeRegex.exec(result.data)) !== null) {
            sizes.push(parseInt(match[1]) || 0);
        }

        for (let i = 0; i < hrefs.length; i++) {
            const href = hrefs[i];
            // 只保留备份文件
            if (href.endsWith('.json') && href.includes('backup')) {
                const name = href.split('/').pop();
                files.push({
                    name,
                    path: href,
                    modified: modifieds[i] || null,
                    size: sizes[i] || 0,
                });
            }
        }

        // 按时间倒序
        files.sort((a, b) => {
            if (a.modified && b.modified) {
                return new Date(b.modified) - new Date(a.modified);
            }
            return b.name.localeCompare(a.name);
        });

        return { success: true, data: files };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * 删除 WebDAV 文件
 */
async function deleteFile(config, remotePath) {
    try {
        const result = await webdavRequest(config, 'DELETE', remotePath);

        if (result.ok || result.status === 204 || result.status === 404) {
            return { success: true };
        } else {
            return { success: false, error: `删除失败: HTTP ${result.status}` };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

module.exports = {
    testConnection,
    uploadFile,
    downloadFile,
    listFiles,
    deleteFile,
};
