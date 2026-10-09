// Leonardo: раздаёт index.html и безопасно проксирует запросы к Gemini (ключ живёт только на сервере)
const http = require('http'), fs = require('fs'), path = require('path');
const KEY = process.env.GEMINI_API_KEY, MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash', PORT = process.env.PORT || 3000;
const hits = new Map();
const limited = ip => { const n = Date.now(), a = (hits.get(ip) || []).filter(t => n - t < 60000); a.push(n); hits.set(ip, a); return a.length > 20; }; // 20 запросов/мин на IP

http.createServer(async (req, res) => {
  const send = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (req.method === 'GET' && req.url === '/api/status') return send(200, { gemini: !!KEY });
  if (req.method === 'POST' && req.url === '/api/gemini') {
    if (!KEY) return send(503, { error: 'GEMINI_API_KEY не задан' });
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (limited(ip)) return send(429, { error: 'Слишком много запросов' });
    let b = ''; for await (const c of req) { b += c; if (b.length > 20000) return send(413, { error: 'Слишком большой запрос' }); }
    try {
      const { kind, system, prompt } = JSON.parse(b);
      const body = {
        systemInstruction: { parts: [{ text: String(system || '').slice(0, 3000) }] },
        contents: [{ role: 'user', parts: [{ text: String(prompt || '').slice(0, 8000) }] }],
        generationConfig: { temperature: 0.7, ...(kind === 'task' ? { responseMimeType: 'application/json' } : {}) }
      };
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) console.error('Gemini error', r.status, d.error?.status, d.error?.message); // видно в Render → Logs
      const text = (d.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
      if (!text) console.error('Gemini вернул пустой ответ', JSON.stringify(d).slice(0, 300));
      return text ? send(200, { text }) : send(502, { error: 'Пустой ответ Gemini' });
    } catch (e) { console.error('Ошибка сервера:', e.message); return send(500, { error: 'Ошибка сервера' }); }
  }
  fs.readFile(path.join(__dirname, 'index.html'), (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d);
  });
}).listen(PORT, () => console.log('Leonardo запущен на порту ' + PORT));
