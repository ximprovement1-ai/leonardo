// Leonardo: раздаёт index.html и безопасно проксирует запросы к ИИ (ключи живут только на сервере).
// Если задан GROQ_API_KEY — используется Groq, иначе GEMINI_API_KEY — Gemini.
const http = require('http'), fs = require('fs'), path = require('path');
const GROQ = process.env.GROQ_API_KEY, GEMINI = process.env.GEMINI_API_KEY, PORT = process.env.PORT || 3000;
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const hits = new Map();
const limited = ip => { const n = Date.now(), a = (hits.get(ip) || []).filter(t => n - t < 60000); a.push(n); hits.set(ip, a); return a.length > 20; }; // 20 запросов/мин на IP

async function callGroq(kind, system, prompt) {
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + GROQ },
    body: JSON.stringify({ model: GROQ_MODEL, temperature: 0.7,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
      ...(kind === 'task' ? { response_format: { type: 'json_object' } } : {}) }) });
  const d = await r.json();
  if (!r.ok) console.error('Groq error', r.status, d.error?.code, d.error?.message); // видно в Render → Logs
  return d.choices?.[0]?.message?.content || '';
}
async function callGemini(kind, system, prompt) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, ...(kind === 'task' ? { responseMimeType: 'application/json' } : {}) } }) });
  const d = await r.json();
  if (!r.ok) console.error('Gemini error', r.status, d.error?.status, d.error?.message);
  return (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}

http.createServer(async (req, res) => {
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.method === 'GET' && req.url === '/api/status') return send(200, { gemini: !!(GROQ || GEMINI), provider: GROQ ? 'groq' : GEMINI ? 'gemini' : null });
  if (req.method === 'POST' && req.url === '/api/gemini') {
    if (!GROQ && !GEMINI) return send(503, { error: 'Не задан GROQ_API_KEY или GEMINI_API_KEY' });
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (limited(ip)) return send(429, { error: 'Слишком много запросов' });
    let b = ''; for await (const c of req) { b += c; if (b.length > 20000) return send(413, { error: 'Слишком большой запрос' }); }
    try {
      const { kind, system, prompt } = JSON.parse(b);
      const sys = String(system || '').slice(0, 3000), pr = String(prompt || '').slice(0, 8000);
      const text = GROQ ? await callGroq(kind, sys, pr) : await callGemini(kind, sys, pr);
      if (!text) console.error('ИИ вернул пустой ответ');
      return text ? send(200, { text }) : send(502, { error: 'Пустой ответ ИИ' });
    } catch (e) { console.error('Ошибка сервера:', e.message); return send(500, { error: 'Ошибка сервера' }); }
  }
  fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d);
  });
}).listen(PORT, () => console.log('Leonardo запущен на порту ' + PORT + ', ИИ: ' + (GROQ ? 'Groq' : GEMINI ? 'Gemini' : 'нет ключа (demo)')));
