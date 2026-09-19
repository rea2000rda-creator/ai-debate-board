// providers.js
// อะแดปเตอร์เรียก API ของแต่ละแพลตฟอร์ม ให้คืนค่ารูปแบบเดียวกัน: string คำตอบ
// เพิ่มแพลตฟอร์มใหม่ได้โดยเติมฟังก์ชันใหม่ในรูปแบบเดียวกัน แล้วเพิ่มใน REGISTRY

async function callOpenAI(messages) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages,
      max_tokens: 500
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content.trim();
}

async function callGemini(messages) {
  const system = messages.find((m) => m.role === 'system')?.content;
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        generationConfig: { maxOutputTokens: 500 }
      })
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates[0].content.parts.map((p) => p.text).join('').trim();
}

async function callAnthropic(messages) {
  const system = messages.find((m) => m.role === 'system')?.content;
  const rest = messages.filter((m) => m.role !== 'system');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      system,
      messages: rest,
      max_tokens: 500
    })
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

const REGISTRY = [
  { id: 'openai', label: 'ChatGPT', color: '#10a37f', envKey: 'OPENAI_API_KEY', call: callOpenAI },
  { id: 'gemini', label: 'Gemini', color: '#4285f4', envKey: 'GEMINI_API_KEY', call: callGemini },
  { id: 'anthropic', label: 'Claude', color: '#d97757', envKey: 'ANTHROPIC_API_KEY', call: callAnthropic }
];

function getActiveProviders() {
  return REGISTRY.filter((p) => !!process.env[p.envKey]);
}

module.exports = { getActiveProviders };
