/**
 * AI 助手命令 - 增强版（流式回复效果）
 */
const { loadSettings, getActiveAiConfig } = require('../settings');

// 对话历史存储
const conversationHistory = new Map();

// 活跃会话跟踪（用于无命令连续对话）
const activeSessions = new Map(); // userId -> { lastActive: timestamp, chatId: number }
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5分钟超时

// 流式更新配置
const STREAM_UPDATE_INTERVAL = 800; // 更新间隔(毫秒)
const TYPING_CHARS = ['▌', '█', '▌', ' ']; // 打字机光标效果

function setup(bot, { logger }) {
  // /chat 或 /c 命令
  const handleChat = async (ctx) => {
    const settings = loadSettings();
    const text = ctx.message.text.split(' ').slice(1).join(' ').trim();
    const userId = ctx.from.id.toString();

    if (!text) {
      return ctx.reply(
        '💬 <b>AI 对话助手</b>\n\n' +
        '<code>/chat 内容</code> - 开始对话\n' +
        '<code>/c 内容</code> - 简写命令\n' +
        '<code>/chat clear</code> - 清除记忆\n\n' +
        '💡 支持多轮对话，AI 会记住上下文',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🧹 清除记忆', callback_data: 'ai_clear_history' }],
              [
                { text: '🔙 返回 AI 菜单', callback_data: 'menu_ai' },
                { text: '🏠 主菜单', callback_data: 'menu_main' },
              ],
            ]
          }
        }
      );
    }

    if (text.toLowerCase() === 'clear') {
      conversationHistory.delete(userId);
      activeSessions.delete(userId); // 同时清除活跃状态
      return ctx.reply('✅ 对话历史已清除，连续对话已关闭', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 开始新对话', callback_data: 'ai_new_chat' }],
            [
              { text: '🔙 返回 AI 菜单', callback_data: 'menu_ai' },
              { text: '🏠 主菜单', callback_data: 'menu_main' },
            ],
          ]
        }
      });
    }

    const aiConfig = getActiveAiConfig(settings);
    if (!aiConfig.apiKey) {
      return ctx.reply(
        '❌ <b>未配置 AI 服务</b>\n\n请在配置面板中添加 AI API 配置',
        { parse_mode: 'HTML' }
      );
    }

    // 激活连续对话会话
    activeSessions.set(userId, { lastActive: Date.now(), chatId: ctx.chat.id });

    // 获取或创建对话历史
    if (!conversationHistory.has(userId)) {
      conversationHistory.set(userId, []);
    }
    const history = conversationHistory.get(userId);

    // 添加用户消息
    history.push({ role: 'user', content: text });

    // 保留最近 10 轮对话 (20条消息)
    while (history.length > 20) {
      history.shift();
    }

    // 发送"思考中"消息
    const loading = await ctx.reply('🤔 <i>思考中...</i>', { parse_mode: 'HTML' });

    let fullResponse = '';
    let lastUpdateTime = 0;
    let cursorIndex = 0;

    try {
      const response = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: aiConfig.model || 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: '你是一个有帮助的助手，用中文回复。回答要简洁有条理。' },
            ...history,
          ],
          max_tokens: 2000,
          stream: true, // 开启流式
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullResponse += content;

                // 节流更新 - 避免 API 限制
                const now = Date.now();
                if (now - lastUpdateTime > STREAM_UPDATE_INTERVAL) {
                  lastUpdateTime = now;
                  cursorIndex = (cursorIndex + 1) % TYPING_CHARS.length;

                  try {
                    await ctx.telegram.editMessageText(
                      ctx.chat.id,
                      loading.message_id,
                      null,
                      `🤖 ${fullResponse}${TYPING_CHARS[cursorIndex]}`,
                      { parse_mode: 'Markdown' }
                    );
                  } catch (e) {
                    // 如果 Markdown 解析失败（通常是流式过程中符号不完整），则降级为纯文本
                    try {
                      await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        loading.message_id,
                        null,
                        `🤖 ${fullResponse}${TYPING_CHARS[cursorIndex]}`
                      );
                    } catch (e2) {
                      // 忽略消息未变化的错误
                    }
                  }
                }
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }

      // 最终更新
      if (fullResponse) {
        history.push({ role: 'assistant', content: fullResponse });

        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            loading.message_id,
            null,
            `🤖 ${fullResponse}`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🔄 重新生成', callback_data: `ai_regen_${loading.message_id}` },
                    { text: '🧹 清除记忆', callback_data: 'ai_clear_history' },
                  ],
                  [
                    { text: '🔙 返回 AI 菜单', callback_data: 'menu_ai' },
                    { text: '🏠 主菜单', callback_data: 'menu_main' },
                  ],
                ]
              }
            }
          );
        } catch (e) {
          // 最终回复如果 Markdown 解析还是失败，则以纯文本发送
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            loading.message_id,
            null,
            `🤖 ${fullResponse}`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🔄 重新生成', callback_data: `ai_regen_${loading.message_id}` },
                    { text: '🧹 清除记忆', callback_data: 'ai_clear_history' },
                  ],
                  [
                    { text: '🔙 返回 AI 菜单', callback_data: 'menu_ai' },
                    { text: '🏠 主菜单', callback_data: 'menu_main' },
                  ],
                ]
              }
            }
          );
        }
      }
    } catch (error) {
      logger.error(`AI 请求失败: ${error.message}`);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loading.message_id,
        null,
        `❌ <b>请求失败</b>\n\n${error.message}`,
        { parse_mode: 'HTML' }
      );
    }
  };

  bot.command('chat', handleChat);
  bot.command('c', handleChat);

  // 清除历史回调
  bot.action('ai_clear_history', async (ctx) => {
    const userId = ctx.from.id.toString();
    conversationHistory.delete(userId);
    await ctx.answerCbQuery('✅ 记忆已清除');
    try {
      await ctx.editMessageText('✅ 对话历史已清除，可以开始新对话了', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 发送 /chat 开始', callback_data: 'ai_noop' }],
            [
              { text: '🔙 返回 AI 菜单', callback_data: 'menu_ai' },
              { text: '🏠 主菜单', callback_data: 'menu_main' },
            ],
          ]
        }
      });
    } catch (e) { }
  });

  // 空操作
  bot.action('ai_noop', (ctx) => ctx.answerCbQuery());
  bot.action('ai_new_chat', (ctx) => ctx.answerCbQuery('💬 请发送 /chat <内容> 开始对话'));

  // /sum 命令 - 智能摘要
  bot.command('sum', async (ctx) => {
    const settings = loadSettings();
    let text = ctx.message.text.split(' ').slice(1).join(' ').trim();

    // 如果是回复消息，获取被回复的内容
    if (ctx.message.reply_to_message && !text) {
      text = ctx.message.reply_to_message.text || '';
    }

    if (!text) {
      return ctx.reply('❌ 用法: /sum <文本或链接>\n或回复消息使用 /sum');
    }

    const aiConfig = getActiveAiConfig(settings);
    if (!aiConfig.apiKey) {
      return ctx.reply('❌ 未配置 AI API');
    }

    const loading = await ctx.reply('📝 正在生成摘要...');

    try {
      // 如果是 URL，先获取内容
      let contentToSummarize = text;
      if (text.match(/^https?:\/\//)) {
        try {
          const response = await fetch(text);
          const html = await response.text();
          // 简单提取文本内容
          contentToSummarize = html.replace(/<[^>]*>/g, ' ').substring(0, 5000);
        } catch (e) {
          contentToSummarize = text;
        }
      }

      const response = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: aiConfig.model || 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: '你是一个专业的摘要助手。请用中文为以下内容生成简洁的摘要，突出要点。' },
            { role: 'user', content: contentToSummarize.substring(0, 4000) },
          ],
          max_tokens: 1000,
        }),
      });

      const data = await response.json();

      if (data.choices && data.choices[0]) {
        const summary = data.choices[0].message.content;
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          loading.message_id,
          null,
          `📝 <b>摘要</b>\n\n${summary}`,
          { parse_mode: 'HTML' }
        );
      } else if (data.error) {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          loading.message_id,
          null,
          `❌ API 错误: ${data.error.message}`
        );
      }
    } catch (error) {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loading.message_id,
        null,
        `❌ 生成失败: ${error.message}`
      );
    }
  });

  // ========== 无命令连续对话 ==========
  // 处理普通文本消息（非命令）
  const handleContinuousChat = async (ctx, text) => {
    const settings = loadSettings();
    const userId = ctx.from.id.toString();
    const aiConfig = getActiveAiConfig(settings);

    if (!aiConfig.apiKey) {
      return; // 未配置 AI，静默忽略
    }

    // 更新活跃状态
    activeSessions.set(userId, { lastActive: Date.now(), chatId: ctx.chat.id });

    // 获取或创建对话历史
    if (!conversationHistory.has(userId)) {
      conversationHistory.set(userId, []);
    }
    const history = conversationHistory.get(userId);

    // 添加用户消息
    history.push({ role: 'user', content: text });

    // 保留最近 10 轮对话
    while (history.length > 20) {
      history.shift();
    }

    // 发送"思考中"消息
    const loading = await ctx.reply('🤔 思考中...', { parse_mode: 'HTML' });

    let fullResponse = '';
    let lastUpdateTime = 0;
    let cursorIndex = 0;

    try {
      const response = await fetch(`${aiConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${aiConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: aiConfig.model || 'gpt-3.5-turbo',
          messages: [
            { role: 'system', content: '你是一个有帮助的助手，用中文回复。回答要简洁有条理。' },
            ...history,
          ],
          max_tokens: 2000,
          stream: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullResponse += content;

                const now = Date.now();
                if (now - lastUpdateTime > STREAM_UPDATE_INTERVAL) {
                  lastUpdateTime = now;
                  cursorIndex = (cursorIndex + 1) % TYPING_CHARS.length;

                  try {
                    await ctx.telegram.editMessageText(
                      ctx.chat.id,
                      loading.message_id,
                      null,
                      `🤖 ${fullResponse}${TYPING_CHARS[cursorIndex]}`,
                      { parse_mode: 'Markdown' }
                    );
                  } catch (e) {
                    // 降级处理
                    try {
                      await ctx.telegram.editMessageText(
                        ctx.chat.id,
                        loading.message_id,
                        null,
                        `🤖 ${fullResponse}${TYPING_CHARS[cursorIndex]}`
                      );
                    } catch (e2) {}
                  }
                }
              }
            } catch (e) { }
          }
        }
      }

      // 最终更新
      if (fullResponse) {
        history.push({ role: 'assistant', content: fullResponse });

        try {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            loading.message_id,
            null,
            `🤖 ${fullResponse}`,
            {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🧹 清除记忆', callback_data: 'ai_clear_history' },
                    { text: '⏹️ 结束对话', callback_data: 'ai_end_session' },
                  ],
                  [
                    { text: '🔙 返回 AI 菜单', callback_data: 'menu_ai' },
                    { text: '🏠 主菜单', callback_data: 'menu_main' },
                  ],
                ]
              }
            }
          );
        } catch (e) {
          await ctx.telegram.editMessageText(
            ctx.chat.id,
            loading.message_id,
            null,
            `🤖 ${fullResponse}`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🧹 清除记忆', callback_data: 'ai_clear_history' },
                    { text: '⏹️ 结束对话', callback_data: 'ai_end_session' },
                  ],
                  [
                    { text: '🔙 返回 AI 菜单', callback_data: 'menu_ai' },
                    { text: '🏠 主菜单', callback_data: 'menu_main' },
                  ],
                ]
              }
            }
          );
        }
      }
    } catch (error) {
      logger.error(`AI 请求失败: ${error.message}`);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        loading.message_id,
        null,
        `❌ 请求失败: ${error.message}`,
        { parse_mode: 'HTML' }
      );
    }
  };

  // 监听普通文本消息
  bot.on('text', async (ctx, next) => {
    const text = ctx.message.text;
    const userId = ctx.from.id.toString();

    // 跳过命令
    if (text.startsWith('/')) {
      return next();
    }

    // 检查是否在活跃会话中
    const session = activeSessions.get(userId);
    if (session && (Date.now() - session.lastActive) < SESSION_TIMEOUT) {
      // 在活跃会话中，处理为 AI 对话
      await handleContinuousChat(ctx, text);
    } else {
      // 不在活跃会话中，传递给下一个处理器
      return next();
    }
  });

  // 结束会话按钮回调
  bot.action('ai_end_session', async (ctx) => {
    const userId = ctx.from.id.toString();
    activeSessions.delete(userId);
    await ctx.answerCbQuery('✅ 连续对话已结束');
    try {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    } catch (e) { }
  });

  logger.info('🤖 AI 命令已加载（支持无命令连续对话）');
}

module.exports = { setup };
