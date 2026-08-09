require('dotenv').config();
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