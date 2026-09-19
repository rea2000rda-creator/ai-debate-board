const providerStatusEl = document.getElementById('provider-status');
const form = document.getElementById('question-form');
const input = document.getElementById('question-input');
const roundsSelect = document.getElementById('rounds-select');
const submitBtn = document.getElementById('submit-btn');
const statusLine = document.getElementById('status-line');
const board = document.getElementById('board');
const verdict = document.getElementById('verdict');

let providersCache = [];

async function loadProviders() {
  const res = await fetch('/api/providers');
  const data = await res.json();
  providersCache = data.providers;
  providerStatusEl.innerHTML = '';
  if (providersCache.length === 0) {
    providerStatusEl.innerHTML = '<span class="provider-chip">ยังไม่ได้ตั้งค่า API key ใดเลย — ดู .env.example</span>';
    submitBtn.disabled = true;
    return;
  }
  providersCache.forEach((p) => {
    const chip = document.createElement('span');
    chip.className = 'provider-chip';
    chip.innerHTML = `<span class="dot" style="background:${p.color}"></span>${p.label}`;
    providerStatusEl.appendChild(chip);
  });
  if (providersCache.length < 2) {
    statusLine.hidden = false;
    statusLine.textContent = 'ต้องมีอย่างน้อย 2 แพลตฟอร์มที่ตั้งค่า API key แล้วจึงจะเริ่มถกได้';
    submitBtn.disabled = true;
  }
}

function makeColumn(p) {
  const col = document.createElement('div');
  col.className = 'column';
  col.id = `col-${p.id}`;
  col.innerHTML = `
    <div class="column-header">
      <span class="avatar" style="background:${p.color}"></span>
      <span class="name">${p.label}</span>
    </div>
    <div class="messages"></div>
  `;
  return col;
}

function addBubble(providerId, round, text, isError) {
  const col = document.getElementById(`col-${providerId}`);
  if (!col) return;
  const bubble = document.createElement('div');
  bubble.className = 'bubble' + (isError ? ' error' : '');
  bubble.innerHTML = `<span class="round-tag">รอบ ${round}</span>${escapeHtml(text)}`;
  col.querySelector('.messages').appendChild(bubble);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const question = input.value.trim();
  if (!question) return;

  board.innerHTML = '';
  verdict.hidden = true;
  verdict.innerHTML = '';
  submitBtn.disabled = true;
  statusLine.hidden = false;
  statusLine.textContent = 'กำลังเริ่มถก...';

  const rounds = roundsSelect.value;
  const url = `/api/debate?question=${encodeURIComponent(question)}&rounds=${rounds}`;
  const es = new EventSource(url);

  es.addEventListener('start', (e) => {
    const data =
