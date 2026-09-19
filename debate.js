// debate.js
// ตรรกะหลักของการถกเถียง: แยกออกมาจาก server.js เพื่อให้ทั้ง endpoint สำหรับเบราว์เซอร์ (SSE)
// และ endpoint สำหรับโปรแกรม/AI อื่น (JSON) เรียกใช้ตรรกะเดียวกัน
//
// onEvent(eventName, payload) ถูกเรียกระหว่างทาง ถ้าไม่ต้องการ live events (เช่นตอนเรียกแบบ JSON
// ล้วนๆ) ให้ส่ง no-op function เข้ามาได้

function buildMessages(question, round, provider, allProviders, transcript) {
  if (round === 1) {
    return [
      { role: 'system', content: 'ตอบคำถามอย่างกระชับ ชัดเจน มีเหตุผลรองรับ ความยาวไม่เกิน 5-6 ประโยค' },
      { role: 'user', content: question }
    ];
  }
  const othersLatest = allProviders
    .filter((p) => p.id !== provider.id)
    .map((p) => {
      const last = transcript[p.id][transcript[p.id].length - 1];
      return `${p.label}: ${last ? last.text : '(ไม่มีคำตอบ)'}`;
    })
    .join('\n\n');
  const ownLast = transcript[provider.id][transcript[provider.id].length - 1]?.text || '';

  return [
    {
      role: 'system',
      content:
        'นี่คือการถกเถียงระหว่าง AI หลายตัวเพื่อหาคำตอบที่ดีที่สุด อ่านคำตอบของ AI ตัวอื่น ชี้จุดที่เห็นด้วย/ไม่เห็นด้วยสั้นๆ แล้วปรับปรุงคำตอบของตัวเองให้ดีขึ้น ตอบกระชับไม่เกิน 5-6 ประโยค'
    },
    {
      role: 'user',
      content: `คำถามเดิม: ${question}\n\nคำตอบของคุณในรอบก่อนหน้า:\n${ownLast}\n\nคำตอบของ AI ตัวอื่นในรอบก่อนหน้า:\n${othersLatest}\n\nกรุณาให้คำตอบที่ปรับปรุงแล้วของคุณ`
    }
  ];
}

async function runDebate({ question, rounds, providers, onEvent }) {
  const transcript = {};
  providers.forEach((p) => (transcript[p.id] = []));

  onEvent('start', { question, rounds, providers: providers.map((p) => ({ id: p.id, label: p.label, color: p.color })) });

  for (let round = 1; round <= rounds; round++) {
    onEvent('round_start', { round });

    const results = await Promise.all(
      providers.map(async (p) => {
        const messages = buildMessages(question, round, p, providers, transcript);
        try {
          const text = await p.call(messages);
          return { id: p.id, text };
        } catch (err) {
          return { id: p.id, text: `[เกิดข้อผิดพลาดในการเรียก ${p.label}: ${err.message}]`, error: true };
        }
      })
    );

    for (const r of results) {
      transcript[r.id].push({ round, text: r.text });
      onEvent('message', { providerId: r.id, round, text: r.text, error: !!r.error });
    }
    onEvent('round_end', { round });
  }

  // รอบโหวต: แต่ละ AI โหวตให้คำตอบสุดท้ายของ AI ตัวอื่น (ไม่โหวตให้ตัวเอง)
  onEvent('vote_start', {});
  const finalAnswers = providers.map((p) => ({
    id: p.id,
    label: p.label,
    text: transcript[p.id][transcript[p.id].length - 1]?.text || ''
  }));

  const votes = await Promise.all(
    providers.map(async (p) => {
      const others = finalAnswers.filter((a) => a.id !== p.id);
      const ballot = others.map((a, i) => `[${i + 1}] (${a.label}): ${a.text}`).join('\n\n');
      const messages = [
        {
          role: 'system',
          content:
            'คุณกำลังโหวตหาคำตอบที่ดีที่สุดในบรรดาคำตอบต่อไปนี้ (ไม่ใช่ของตัวเอง) ตอบกลับเป็น JSON เท่านั้น รูปแบบ {"choice": หมายเลข, "reason": "เหตุผลสั้นๆ ไม่เกิน 1 ประโยค"} ห้ามมีข้อความอื่นนอกจาก JSON'
        },
        { role: 'user', content: `คำถามเดิม: ${question}\n\nคำตอบที่ให้เลือก:\n${ballot}` }
      ];
      try {
        const raw = await p.call(messages);
        const cleaned = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        const chosen = others[parsed.choice - 1];
        return { voter: p.id, votedFor: chosen ? chosen.id : null, reason: parsed.reason || '' };
      } catch (err) {
        return { voter: p.id, votedFor: null, reason: 'ไม่สามารถแปลผลโหวตได้' };
      }
    })
  );

  votes.forEach((v) => onEvent('vote', v));

  const tally = {};
  providers.forEach((p) => (tally[p.id] = 0));
  votes.forEach((v) => {
    if (v.votedFor && tally[v.votedFor] !== undefined) tally[v.votedFor]++;
  });
  const winnerId = Object.keys(tally).reduce((a, b) => (tally[b] > tally[a] ? b : a));

  onEvent('result', { tally, winnerId });
  onEvent('done', {});

  return { question, rounds, transcript, finalAnswers, votes, tally, winnerId };
}

module.exports = { runDebate };
