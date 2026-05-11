const os = require('os');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { execFile } = require('child_process');
const renderLottie = require('puppeteer-lottie');
const sharp = require('sharp');
const archiver = require('archiver');
const multer = require('multer');
const { getBrowser } = require('../puppeteer.service');

const execFileAsync = promisify(execFile);
const puppeteerWSEndpoint = process.env.PUPPETEER_WS_ENDPOINT || null;
const STICKER_CACHE_MAX_AGE_DAYS = 7;
const STICKER_CACHE_MAX_SIZE_MB = 500;
const MAX_STICKERS_PER_PACK = 120;
const STICKER_IMPORT_MAX_FILE_SIZE = 512 * 1024;
const STICKER_IMPORT_ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/webp',
  'image/jpeg',
  'image/jpg',
  'image/gif',
]);

function registerStickersRoutes(app, { getDataPath, getCurrentBot, loadSettings, logger, storage }) {
  const stickerCacheDir = path.join(getDataPath(), 'cache', 'stickers');

  function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  function cleanStickerCache() {
    if (!fs.existsSync(stickerCacheDir)) {
      return { deleted: 0, freedBytes: 0 };
    }

    const now = Date.now();
    const maxAge = STICKER_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    let deleted = 0;
    let freedBytes = 0;

    try {
      const files = fs.readdirSync(stickerCacheDir);
      const fileInfos = files.map(file => {
        const filePath = path.join(stickerCacheDir, file);
        try {
          const stats = fs.statSync(filePath);
          return { file, filePath, stats, atime: stats.atimeMs, size: stats.size };
        } catch {
          return null;
        }
      }).filter(Boolean);

      for (const info of fileInfos) {
        if (now - info.atime > maxAge) {
          try {
            fs.unlinkSync(info.filePath);
            deleted++;
            freedBytes += info.size;
          } catch (e) {
            logger.warn(`删除缓存文件失败: ${info.file}: ${e.message}`);
          }
        }
      }

      const remainingFiles = fileInfos.filter(info => fs.existsSync(info.filePath));
      let totalSize = remainingFiles.reduce((sum, info) => sum + info.size, 0);
      const maxSize = STICKER_CACHE_MAX_SIZE_MB * 1024 * 1024;

      if (totalSize > maxSize) {
        remainingFiles.sort((a, b) => a.atime - b.atime);

        for (const info of remainingFiles) {
          if (totalSize <= maxSize) break;
          try {
            fs.unlinkSync(info.filePath);
            deleted++;
            freedBytes += info.size;
            totalSize -= info.size;
          } catch (e) {
            logger.warn(`删除缓存文件失败: ${info.file}: ${e.message}`);
          }
        }
      }

      if (deleted > 0) {
        logger.info(`🧹 清理贴纸缓存: 删除 ${deleted} 个文件, 释放 ${(freedBytes / 1024 / 1024).toFixed(2)} MB`);
      }
    } catch (e) {
      logger.error(`清理缓存失败: ${e.message}`);
    }

    return { deleted, freedBytes };
  }

  function getStickerCacheStats() {
    if (!fs.existsSync(stickerCacheDir)) {
      return { fileCount: 0, totalSize: 0, totalSizeMB: '0.00' };
    }

    try {
      const files = fs.readdirSync(stickerCacheDir);
      let totalSize = 0;

      for (const file of files) {
        try {
          const stats = fs.statSync(path.join(stickerCacheDir, file));
          totalSize += stats.size;
        } catch {}
      }

      return {
        fileCount: files.length,
        totalSize,
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2)
      };
    } catch {
      return { fileCount: 0, totalSize: 0, totalSizeMB: '0.00' };
    }
  }

  async function runFfmpeg(args) {
    await execFileAsync('ffmpeg', args);
  }

  async function fetchStickerFile(fileId) {
    const currentBot = getCurrentBot();
    const fetch = require('node-fetch');
    const file = await currentBot.telegram.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${currentBot.telegram.token}/${file.file_path}`;
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error(`Telegram download failed: ${response.status}`);
    }
    return response.buffer();
  }

  async function convertTgsToGif(buffer, outputPath) {
    const animationData = JSON.parse(zlib.gunzipSync(buffer).toString('utf-8'));
    const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgs-frames-'));
    const fps = Number(animationData.fr) || 30;

    try {
      let browser = null;
      if (puppeteerWSEndpoint) {
        const puppeteer = require('puppeteer');
        browser = await puppeteer.connect({ browserWSEndpoint: puppeteerWSEndpoint });
      } else {
        browser = await getBrowser();
      }

      const shouldCloseBrowser = puppeteerWSEndpoint ? true : false;

      await renderLottie({
        animationData,
        output: path.join(framesDir, 'frame-%04d.png'),
        width: 512,
        height: 512,
        quiet: true,
        renderer: 'svg',
        browser,
        puppeteerOptions: {
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--single-process',
            '--no-zygote',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
          ],
        },
      });

      if (shouldCloseBrowser && browser) {
        await browser.disconnect();
      }

      await runFfmpeg([
        '-y',
        '-framerate',
        String(fps),
        '-i',
        path.join(framesDir, 'frame-%04d.png'),
        '-vf',
        'scale=512:-1:flags=lanczos',
        '-loop',
        '0',
        outputPath,
      ]);
    } finally {
      fs.rmSync(framesDir, { recursive: true, force: true });
    }
  }

  async function convertWebmToGif(inputPath, outputPath) {
    await runFfmpeg([
      '-y',
      '-i',
      inputPath,
      '-vf',
      'scale=512:-1:flags=lanczos',
      '-loop',
      '0',
      outputPath,
    ]);
  }

  function sanitizeFileName(name) {
    return String(name || 'sticker')
      .replace(/[\\/\?%\*:|"<>]/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 80);
  }

  async function convertWebpToPng(inputPath, outputPath) {
    await runFfmpeg([
      '-y',
      '-i',
      inputPath,
      outputPath,
    ]);
  }

  async function getConvertedStickerFile(fileId, type) {
    ensureDir(stickerCacheDir);
    const ext = type === 'static' ? 'png' : 'gif';
    const cachePath = path.join(stickerCacheDir, `${fileId}.${ext}`);

    if (fs.existsSync(cachePath)) {
      return { cachePath, ext };
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sticker-'));
    const sourceExt = type === 'animated' ? 'tgs' : type === 'video' ? 'webm' : 'webp';
    const sourcePath = path.join(tempDir, `source.${sourceExt}`);
    const outputPath = path.join(tempDir, `output.${ext}`);

    try {
      const buffer = await fetchStickerFile(fileId);
      fs.writeFileSync(sourcePath, buffer);

      if (type === 'animated') {
        await convertTgsToGif(buffer, outputPath);
      } else if (type === 'video') {
        await convertWebmToGif(sourcePath, outputPath);
      } else {
        await convertWebpToPng(sourcePath, outputPath);
      }

      fs.copyFileSync(outputPath, cachePath);
      return { cachePath, ext };
    } catch (error) {
      if (fs.existsSync(cachePath)) {
        fs.unlinkSync(cachePath);
      }
      throw error;
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  async function convertImageToStaticStickerPng(inputBuffer) {
    const sizeAttempts = [512, 480, 448, 416, 384, 352, 320, 288, 256];

    for (const size of sizeAttempts) {
      const outputBuffer = await sharp(inputBuffer, { animated: false, failOn: 'none' })
        .rotate()
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          withoutEnlargement: true,
        })
        .png({
          compressionLevel: 9,
          palette: true,
          quality: 90,
          effort: 8,
        })
        .toBuffer();

      if (outputBuffer.length <= STICKER_IMPORT_MAX_FILE_SIZE) {
        return outputBuffer;
      }
    }

    throw new Error('图片转换后仍超过 512KB，请使用更简单或更小尺寸的图片');
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: STICKER_IMPORT_MAX_FILE_SIZE,
      files: 120,
    },
    fileFilter: (req, file, cb) => {
      if (STICKER_IMPORT_ALLOWED_MIME_TYPES.has(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('只支持 PNG/WebP/JPG/JPEG/GIF 格式'));
      }
    },
  });

  app.get('/api/sticker-packs', (req, res) => {
    const packs = storage.getUserStickerPacks();
    res.json({ success: true, data: packs });
  });

  app.delete('/api/sticker-packs/:name', (req, res) => {
    const packName = req.params.name;
    const packs = storage.getUserStickerPacks();
    const pack = packs.find(p => p.name === packName);

    if (!pack) {
      return res.status(404).json({ success: false, error: '贴纸包不存在' });
    }

    storage.deleteUserStickerPack(null, packName);
    res.json({ success: true });
  });

  app.get('/api/sticker-packs/:name/stickers', async (req, res) => {
    const currentBot = getCurrentBot();
    if (!currentBot) {
      return res.status(503).json({ success: false, error: 'Bot 未运行' });
    }

    const packName = req.params.name;

    try {
      const stickerSet = await currentBot.telegram.getStickerSet(packName);
      const stickersWithUrls = await Promise.all(
        stickerSet.stickers.map(async (sticker) => {
          try {
            const type = sticker.is_animated ? 'animated' : sticker.is_video ? 'video' : 'static';
            return {
              fileId: sticker.file_id,
              emoji: sticker.emoji,
              isAnimated: sticker.is_animated,
              isVideo: sticker.is_video,
              width: sticker.width,
              height: sticker.height,
              fileUrl: `/api/stickers/preview/${sticker.file_id}?type=${type}`,
            };
          } catch (e) {
            return {
              fileId: sticker.file_id,
              emoji: sticker.emoji,
              isAnimated: sticker.is_animated,
              isVideo: sticker.is_video,
              error: e.message,
            };
          }
        })
      );

      res.json({
        success: true,
        data: {
          name: stickerSet.name,
          title: stickerSet.title,
          stickerType: stickerSet.sticker_type,
          isAnimated: stickerSet.is_animated,
          isVideo: stickerSet.is_video,
          stickers: stickersWithUrls,
        }
      });
    } catch (error) {
      logger.error(`获取贴纸包失败: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/stickers/preview/:fileId', async (req, res) => {
    const currentBot = getCurrentBot();
    if (!currentBot) {
      return res.status(503).json({ success: false, error: 'Bot 未运行' });
    }

    const { fileId } = req.params;
    const type = req.query.type;
    const resolvedType = type === 'animated' || type === 'video' || type === 'static' ? type : null;

    if (!resolvedType) {
      return res.status(400).json({ success: false, error: 'Invalid sticker type' });
    }

    try {
      const { cachePath, ext } = await getConvertedStickerFile(fileId, resolvedType);
      res.setHeader('Content-Type', ext === 'gif' ? 'image/gif' : 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=604800');
      res.sendFile(cachePath);
    } catch (error) {
      logger.error(`预览贴纸失败: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/sticker-packs/:name/export', async (req, res) => {
    const currentBot = getCurrentBot();
    if (!currentBot) {
      return res.status(503).json({ success: false, error: 'Bot 未运行' });
    }

    const packName = req.params.name;

    try {
      const stickerSet = await currentBot.telegram.getStickerSet(packName);
      const convertedFiles = [];
      let failCount = 0;

      logger.info(`开始导出贴纸包: ${packName}, 共 ${stickerSet.stickers.length} 个贴纸`);

      for (let i = 0; i < stickerSet.stickers.length; i++) {
        const sticker = stickerSet.stickers[i];
        const type = sticker.is_animated ? 'animated' : sticker.is_video ? 'video' : 'static';
        try {
          const { cachePath, ext } = await getConvertedStickerFile(sticker.file_id, type);
          const safeName = sanitizeFileName(sticker.emoji || 'sticker');
          const fileName = `${String(i + 1).padStart(3, '0')}_${safeName}.${ext}`;
          convertedFiles.push({ cachePath, fileName });
          logger.debug(`转换成功 [${i + 1}/${stickerSet.stickers.length}]: ${fileName}`);
        } catch (e) {
          failCount++;
          logger.warn(`导出贴纸包失败 [${i + 1}/${stickerSet.stickers.length}] (类型: ${type}): ${e.message}`);
        }
      }

      if (convertedFiles.length === 0) {
        logger.error(`贴纸包导出失败: ${packName}, 所有 ${stickerSet.stickers.length} 个贴纸转换失败`);
        return res.status(500).json({
          success: false,
          error: `所有 ${stickerSet.stickers.length} 个贴纸转换失败，请检查后端日志`
        });
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${packName}_${Date.now()}.zip"`);
      res.setHeader('Cache-Control', 'no-store');

      const archive = archiver('zip', { zlib: { level: 5 } });
      archive.pipe(res);

      for (const { cachePath, fileName } of convertedFiles) {
        archive.file(cachePath, { name: fileName });
      }

      const metadata = {
        exportedAt: new Date().toISOString(),
        packName: stickerSet.name,
        title: stickerSet.title,
        totalStickers: stickerSet.stickers.length,
        successCount: convertedFiles.length,
        failCount,
        stickers: stickerSet.stickers.map(s => ({
          emoji: s.emoji,
          isAnimated: s.is_animated,
          isVideo: s.is_video,
        })),
      };
      archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

      await archive.finalize();
      logger.info(`贴纸包导出完成: ${packName}, 成功: ${convertedFiles.length}, 失败: ${failCount}`);
    } catch (error) {
      logger.error(`导出贴纸包失败: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  });

  app.get('/api/stickers/cache/stats', (req, res) => {
    const stats = getStickerCacheStats();
    res.json({
      success: true,
      data: {
        ...stats,
        maxAgeDays: STICKER_CACHE_MAX_AGE_DAYS,
        maxSizeMB: STICKER_CACHE_MAX_SIZE_MB,
      }
    });
  });

  app.post('/api/stickers/cache/clean', (req, res) => {
    const result = cleanStickerCache();
    const stats = getStickerCacheStats();
    res.json({
      success: true,
      data: {
        deleted: result.deleted,
        freedMB: (result.freedBytes / 1024 / 1024).toFixed(2),
        currentStats: stats,
      }
    });
  });

  app.get('/api/stickers/groups', (req, res) => {
    const groups = storage.getStickerGroups();
    const stickers = storage.getStickers();
    const groupsWithCount = groups.map(g => ({
      ...g,
      count: stickers.filter(s => s.groupId === g.id).length,
    }));
    res.json({ success: true, data: groupsWithCount });
  });

  app.post('/api/stickers/groups', (req, res) => {
    const { name, userId } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: '分组名称不能为空' });
    }
    const group = storage.addStickerGroup(name, userId || 'admin');
    res.json({ success: true, data: group });
  });

  app.put('/api/stickers/groups/:id', (req, res) => {
    const { name } = req.body;
    const groups = storage.getStickerGroups();
    const group = groups.find(g => g.id === req.params.id);

    if (!group) {
      return res.status(404).json({ success: false, error: '分组不存在' });
    }

    const updated = storage.updateStickerGroup(req.params.id, group.userId, { name });
    res.json({ success: true, data: updated });
  });

  app.delete('/api/stickers/groups/:id', (req, res) => {
    const groups = storage.getStickerGroups();
    const group = groups.find(g => g.id === req.params.id);

    if (!group) {
      return res.status(404).json({ success: false, error: '分组不存在' });
    }

    const deleted = storage.deleteStickerGroup(req.params.id, group.userId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: '分组不存在' });
    }
    res.json({ success: true });
  });

  app.get('/api/stickers/export', async (req, res) => {
    const currentBot = getCurrentBot();
    if (!currentBot) {
      return res.status(503).json({ success: false, error: 'Bot 未运行' });
    }

    const stickers = storage.getStickers();
    if (stickers.length === 0) {
      return res.status(400).json({ success: false, error: '没有可导出的贴纸' });
    }

    try {
      const fetch = require('node-fetch');
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="stickers_${Date.now()}.zip"`);

      const archive = archiver('zip', { zlib: { level: 5 } });
      archive.pipe(res);

      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < stickers.length; i++) {
        const sticker = stickers[i];
        try {
          const file = await currentBot.telegram.getFile(sticker.fileId);
          const fileUrl = `https://api.telegram.org/file/bot${currentBot.telegram.token}/${file.file_path}`;
          const response = await fetch(fileUrl);
          if (!response.ok) {
            failCount++;
            continue;
          }

          const buffer = await response.buffer();
          const ext = sticker.isAnimated ? 'tgs' : sticker.isVideo ? 'webm' : 'webp';
          const fileName = `${String(i + 1).padStart(3, '0')}_${sticker.emoji || 'sticker'}.${ext}`;

          archive.append(buffer, { name: fileName });
          successCount++;

          if (i % 10 === 9) {
            await new Promise(r => setTimeout(r, 100));
          }
        } catch (e) {
          failCount++;
          logger.warn(`导出贴纸失败: ${e.message}`);
        }
      }

      const metadata = {
        exportedAt: new Date().toISOString(),
        totalStickers: stickers.length,
        successCount,
        failCount,
        stickers: stickers.map(s => ({
          emoji: s.emoji,
          setName: s.setName,
          tags: s.tags,
          isAnimated: s.isAnimated,
          isVideo: s.isVideo,
        })),
      };
      archive.append(JSON.stringify(metadata, null, 2), { name: 'metadata.json' });

      await archive.finalize();
      storage.addLog('info', `导出贴纸: ${successCount}/${stickers.length}`, 'sticker');
    } catch (error) {
      logger.error(`导出贴纸失败: ${error.message}`);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  });

  app.post('/api/stickers/import', upload.array('stickers', 120), async (req, res) => {
    const currentBot = getCurrentBot();
    if (!currentBot) {
      return res.status(503).json({ success: false, error: 'Bot 未运行' });
    }

    const settings = loadSettings();
    if (!settings.adminId) {
      return res.status(400).json({ success: false, error: '未配置管理员 ID' });
    }

    const files = req.files;
    const packMode = req.body.packMode === 'existing' ? 'existing' : 'new';
    const targetPackName = String(req.body.packName || '').trim();
    const packTitle = req.body.title || `导入贴纸包 ${new Date().toLocaleDateString('zh-CN')}`;
    const emojis = req.body.emojis || '😀';

    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: '请上传贴纸图片文件' });
    }

    if (packMode === 'existing' && !targetPackName) {
      return res.status(400).json({ success: false, error: '请选择要导入的贴纸包' });
    }

    try {
      const botInfo = await currentBot.telegram.getMe();
      const botUsername = botInfo.username;
      const userId = Number(settings.adminId);
      let packName = targetPackName;
      let finalPackTitle = packTitle;
      let addedCount = 0;
      const errors = [];

      if (packMode === 'existing') {
        const stickerSet = await currentBot.telegram.getStickerSet(targetPackName);
        const isStaticPack = !stickerSet.is_animated && !stickerSet.is_video;

        if (!isStaticPack) {
          return res.status(400).json({
            success: false,
            error: '当前仅支持导入图片到静态贴纸包（动态/视频贴纸包暂不支持）',
          });
        }

        const remainingSlots = MAX_STICKERS_PER_PACK - stickerSet.stickers.length;
        if (remainingSlots <= 0) {
          return res.status(400).json({ success: false, error: '贴纸包已满（最多 120 个贴纸）' });
        }
        if (files.length > remainingSlots) {
          return res.status(400).json({
            success: false,
            error: `贴纸包剩余容量不足，还可添加 ${remainingSlots} 个贴纸`,
          });
        }

        finalPackTitle = stickerSet.title || targetPackName;

        for (let i = 0; i < files.length; i++) {
          try {
            const stickerBuffer = await convertImageToStaticStickerPng(files[i].buffer);
            await currentBot.telegram.addStickerToSet(userId, packName, {
              png_sticker: { source: stickerBuffer },
              emojis: emojis,
            });
            addedCount++;

            if (i % 5 === 0) {
              await new Promise(r => setTimeout(r, 300));
            }
          } catch (e) {
            errors.push(`文件 ${i + 1}: ${e.message}`);
            logger.warn(`添加贴纸失败: ${e.message}`);
          }
        }

        if (addedCount === 0) {
          return res.status(500).json({ success: false, error: '所有图片都导入失败，请检查图片格式或大小' });
        }

        const localPackRecord = storage.getUserStickerPacks().find(p => p.name === packName);
        if (localPackRecord) {
          storage.updateUserStickerPack(localPackRecord.userId, packName, {
            title: finalPackTitle,
            stickerType: 'static',
            stickerCount: (localPackRecord.stickerCount || 0) + addedCount,
          });
        } else {
          storage.addUserStickerPack({
            userId: settings.adminId.toString(),
            name: packName,
            title: finalPackTitle,
            stickerType: 'static',
            stickerCount: stickerSet.stickers.length + addedCount,
            isImported: true,
          });
        }
      } else {
        packName = `import_${Date.now()}_by_${botUsername}`;

        const firstFile = files[0];
        const firstStickerBuffer = await convertImageToStaticStickerPng(firstFile.buffer);

        await currentBot.telegram.createNewStickerSet(userId, packName, finalPackTitle, {
          png_sticker: { source: firstStickerBuffer },
          emojis: emojis,
        });

        logger.info(`创建导入贴纸包: ${packName}`);
        addedCount = 1;

        for (let i = 1; i < files.length; i++) {
          try {
            const stickerBuffer = await convertImageToStaticStickerPng(files[i].buffer);
            await currentBot.telegram.addStickerToSet(userId, packName, {
              png_sticker: { source: stickerBuffer },
              emojis: emojis,
            });
            addedCount++;

            if (i % 5 === 0) {
              await new Promise(r => setTimeout(r, 300));
            }
          } catch (e) {
            errors.push(`文件 ${i + 1}: ${e.message}`);
            logger.warn(`添加贴纸失败: ${e.message}`);
          }
        }

        storage.addUserStickerPack({
          userId: settings.adminId.toString(),
          name: packName,
          title: finalPackTitle,
          stickerType: 'static',
          stickerCount: addedCount,
          isImported: true,
        });
      }

      const actionLabel = packMode === 'existing' ? '导入到已有贴纸包' : '导入创建贴纸包';
      storage.addLog('info', `${actionLabel}: ${finalPackTitle} (${addedCount} 个)`, 'sticker');

      res.json({
        success: true,
        data: {
          mode: packMode,
          packName,
          packTitle: finalPackTitle,
          stickerCount: addedCount,
          totalUploaded: files.length,
          errors: errors.length > 0 ? errors : undefined,
          link: `https://t.me/addstickers/${packName}`,
        },
      });
    } catch (error) {
      logger.error(`导入贴纸失败: ${error.message}`);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/stickers', (req, res) => {
    const stickers = storage.getStickers();
    res.json({ success: true, data: stickers });
  });

  app.get('/api/stickers/:id', (req, res) => {
    const stickers = storage.getStickers();
    const sticker = stickers.find(s => s.id === req.params.id);
    if (!sticker) {
      return res.status(404).json({ success: false, error: '贴纸不存在' });
    }
    res.json({ success: true, data: sticker });
  });

  app.put('/api/stickers/:id', (req, res) => {
    const { tags, groupId } = req.body;
    const stickers = storage.getStickers();
    const sticker = stickers.find(s => s.id === req.params.id);

    if (!sticker) {
      return res.status(404).json({ success: false, error: '贴纸不存在' });
    }

    const updated = storage.updateSticker(req.params.id, sticker.userId, { tags, groupId });
    res.json({ success: true, data: updated });
  });

  app.delete('/api/stickers/:id', (req, res) => {
    const stickers = storage.getStickers();
    const sticker = stickers.find(s => s.id === req.params.id);

    if (!sticker) {
      return res.status(404).json({ success: false, error: '贴纸不存在' });
    }

    const deleted = storage.deleteSticker(req.params.id, sticker.userId);
    if (!deleted) {
      return res.status(404).json({ success: false, error: '贴纸不存在' });
    }
    res.json({ success: true });
  });

  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, error: '文件大小超过限制 (512KB)' });
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return res.status(400).json({ success: false, error: '文件数量超过限制 (最多120个)' });
      }
      return res.status(400).json({ success: false, error: err.message });
    }
    if (err.message === '只支持 PNG/WebP/JPG/JPEG/GIF 格式') {
      return res.status(400).json({ success: false, error: err.message });
    }
    next(err);
  });

  return { cleanStickerCache };
}

module.exports = registerStickersRoutes;
