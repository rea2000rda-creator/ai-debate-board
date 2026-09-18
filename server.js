require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getActiveProviders } = require('./providers');
const { runDebate } = require('./debate');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function checkApiKey(req, res) {
  const required = process.env.API_ACCESS_KEY;
  if (!required) return true; // ไม่ได้ตั้ง key ไว้ = เปิดให้เรียกได้ทุกคน
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token !== required) {
    res.status(401).json({ error: 'unauthorized', message: 'ต้องแนบ header Authorization: Bearer <API_ACCESS_KEY>' });
    return false;
  }
  return true;
}

app.get('/api/providers', (req, res) => {
  const active = getActiveProviders().map((p) => ({ id: p.id, label: p.label, color: p.color }));
  res.json({ providers: active });
});

// ---------------------------------------------------------------------------
// JSON REST API — สำหรับให้โปรแกรม/AI อื่นเรียกใช้โดยตรง ไม่ต้องเปิดเบราว์เซอร์
// POST /api/v1/debate   body: { "question": "...", "rounds": 2 }
// header: Authorization: Bearer <API_ACCESS_KEY>  (ถ้าตั้งค่าไว้)
// คืนค่า JSON ก้อนเดียวหลังถกจบทุกรอบ (เรียกครั้งเดียว รอผลลัพธ์สุดท้าย)
// ---------------------------------------------------------------------------
app.post('/api/v1/debate', async (req, res) => {
  if (!checkApiKey(req, res)) return;

  const question = (req.body?.question || '').toString().trim();
  const rounds = Math.min(Math.max(parseInt(req.body?.rounds, 10) || 2, 1), 4);
  const providers = getActiveProviders();

  if (!question) {
    return res.status(400).json({ error: 'bad_request', message: 'ต้องระบุ question ใน body' });
  }
  if (providers.length < 2) {
    return res.status(400).json({ error: 'not_configured', message: 'ต้องตั้งค่า API key อย่างน้อย 2 แพลตฟอร์มใน .env' });
  }

  try {
    const result = await runDebate({ question, rounds, providers, onEvent: () => {} });
    res.json({
      question: result.question,
      rounds: result.rounds,
      providers: providers.map((p) => ({ id: p.id, label: p.label })),
      transcript: result.transcript, // { providerId: [{round, text}, ...] }
      finalAnswers: result.finalAnswers, // [{id, label, text}]
      votes: result.votes, // [{voter, votedFor, reason}]
      tally: result.tally,
      winner: providers.find((p) => p.id === result.winnerId)?.label || result.winnerId,
      winnerId: result.winnerId
    });
  } catch (err) {
    res.status(500).json({ error: 'debate_failed', message: err.message });
  }
});

// เอกสาร API สั้นๆ แบบอ่านได้ทันที ไว้ให้ AI/นักพัฒนาคนอื่นเช็คก่อนเรียกใช้
app.get('/api/v1/docs', (req, res) => {
  res.json({
    endpoint: 'POST /api/v1/debate',
    auth: process.env.API_ACCESS_KEY
      ? 'ต้องแนบ header Authorization: Bearer <key> — ขอ key จากเจ้าของเว็บนี้'
      : 'ไม่ต้องยืนยันตัวตน',
    request_body: { question: 'string (required)', rounds: 'integer 1-4, default 2' },
    response_shape: {
      question: 'string',
      rounds: 'number',
      providers: '[{id, label}]',
      transcript: '{ [providerId]: [{round, text}] }',
      finalAnswers: '[{id, label, text}]',
      votes: '[{voter, votedFor, reason}]',
      tally: '{ [providerId]: voteCount }',
      winner: 'string (label of winning provider)',
      winnerId: 'string'
    },
    example_curl: `curl -X POST ${req.protocol}://${req.get('host')}/api/v1/debate -H "Content-Type: application/json" -d '{"question":"เมืองหลวงของฝรั่งเศสคืออะไร","rounds":2}'`
  });
});

// ---------------------------------------------------------------------------
// SSE endpoint — สำหรับกระดานบนเว็บที่แสดงผลสดทีละข้อความ
// ---------------------------------------------------------------------------
app.get('/api/debate', async (req, res) => {
  const question = (req.query.question || '').toString().trim();
  const rounds = Math.min(Math.max(parseInt(req.query.rounds, 10) || 2, 1), 4);
  const providers = getActiveProviders();

  if (!question) {
    res.status(400).json({ error: 'ต้องระบุคำถาม (question)' });
    return;
  }
  if (providers.length < 2) {
    res.status(400).json({ error: 'ต้องตั้งค่า API key อย่างน้อย 2 แพลตฟอร์มใน .env' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event, payload) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    await runDebate({ question, rounds, providers, onEvent: send });
  } catch (err) {
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Debate Board running at http://localhost:${PORT}`);
  const active = getActiveProviders();
  if (active.length < 2) {
    console.log('⚠ ตั้งค่า API key อย่างน้อย 2 แพลตฟอร์มใน .env เพื่อเริ่มถกเถียง');
  } else {
    console.log(`พร้อมใช้งาน: ${active.map((p) => p.label).join(', ')}`);
  }
  if (!process.env.API_ACCESS_KEY) {
    console.log('⚠ ยังไม่ได้ตั้งค่า API_ACCESS_KEY — /api/v1/debate เปิดให้ใครก็เรียกได้ (จะกินโควต้า API ของคุณ)');
  }
});
