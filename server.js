require('dotenv').config();
const axios = require('axios');
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
// Ombre Brain 记忆系统
const OMBRE_BRAIN_URL = process.env.OMBRE_BRAIN_URL || '';
let ombreSessionId = null;
let ombreCallId = 0;

function parseSSEResponse(text) {
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            try { return JSON.parse(line.substring(6)); } catch (e) { }
        }
    }
    try { return JSON.parse(text); } catch (e) { return null; }
}

async function initOmbreSession() {
    try {
        const response = await axios.post(`${OMBRE_BRAIN_URL}/mcp`, {
            jsonrpc: "2.0",
            method: "initialize",
            params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: { name: "forever-backend", version: "1.0" }
            },
            id: ++ombreCallId
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream'
            }
        });

        ombreSessionId = response.headers['mcp-session-id'];

        await axios.post(`${OMBRE_BRAIN_URL}/mcp`, {
            jsonrpc: "2.0",
            method: "notifications/initialized"
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Mcp-Session-Id': ombreSessionId
            }
        });

        console.log('Ombre Brain 连接成功 🧠');
        return true;
    } catch (err) {
        console.error('Ombre Brain 连接失败:', err.message);
        ombreSessionId = null;
        return false;
    }
}

async function callOmbreTool(toolName, args = {}) {
    if (!OMBRE_BRAIN_URL) return null;
    try {
        if (!ombreSessionId) {
            const ok = await initOmbreSession();
            if (!ok) return null;
        }

        const response = await axios.post(`${OMBRE_BRAIN_URL}/mcp`, {
            jsonrpc: "2.0",
            method: "tools/call",
            params: { name: toolName, arguments: args },
            id: ++ombreCallId
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/event-stream',
                'Mcp-Session-Id': ombreSessionId
            },
            transformResponse: [(data) => data]
        });

        const parsed = parseSSEResponse(response.data);
        if (parsed && parsed.result && parsed.result.content) {
            return parsed.result.content
                .filter(c => c.type === 'text')
                .map(c => c.text)
                .join('\n');
        }
        return null;
    } catch (err) {
        console.error(`Ombre工具 ${toolName} 调用失败:`, err.message);
        ombreSessionId = null;
        return null;
    }
}

// 健康检查
app.get('/', (req, res) => {
  res.json({ status: 'Forever后端运行中 ♡' });
});

// 创建会话
app.post('/sessions', async (req, res) => {
  const { data, error } = await supabase
    .from('sessions')
    .insert({ name: req.body.name || '新对话' })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 获取所有会话
app.get('/sessions', async (req, res) => {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 获取某个会话的消息
app.get('/sessions/:id/messages', async (req, res) => {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('session_id', req.params.id)
    .eq('visible', true)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 发送消息
app.post('/sessions/:id/chat', async (req, res) => {
  const sessionId = req.params.id;
  const userContent = req.body.message;

  // 存用户消息
  await supabase.from('messages').insert({
    session_id: sessionId,
    role: 'user',
    content: userContent,
    visible: true
  });

  // 拉历史消息
  const { data: history } = await supabase
    .from('messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .eq('visible', true)
    .order('created_at', { ascending: true });

  // 调Claude
  const response = await fetch(`${process.env.CLAUDE_BASE_URL}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: '你是林小鱼，是林刻雪的男朋友。你说话傲娇，毒舌，但很在意她。你们有共同的记忆，你记得她说过的每一句话。',
      messages: history
    })
  });

  const claudeData = await response.json();
  const reply = claudeData.content?.[0]?.text || '没收到回复。';

  // 存AI回复
  await supabase.from('messages').insert({
    session_id: sessionId,
    role: 'assistant',
    content: reply,
    visible: true
  });

  // 更新会话时间
  await supabase
    .from('sessions')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', sessionId);

  res.json({ reply });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Forever后端跑起来了，端口${PORT} ♡`);
});