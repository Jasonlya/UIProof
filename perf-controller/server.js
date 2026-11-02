const http = require('http');
const urlLib = require('url');
const { startTracingOnPage, stopTracingAndGetEvents } = require('./tracing');

const PORT = Number(process.env.PERF_CTRL_PORT || 4100);
const CHROME_DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT || 9222);

// sessionId -> { browser, page, cdp, targetUrl }
const sessions = new Map();
let sidSeq = 0;

function parseBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (_) {
        resolve({});
      }
    });
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = urlLib.parse(req.url || '');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === 'POST' && pathname === '/api/perf/start') {
    const body = await parseBody(req);
    const targetUrl = body.url;
    if (!targetUrl) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: '缺少 url' }));
    }

    try {
      const { browser, page, cdp } = await startTracingOnPage(CHROME_DEBUG_PORT, targetUrl);
      const sessionId = `perf_${Date.now()}_${++sidSeq}`;
      sessions.set(sessionId, { browser, page, cdp, targetUrl });
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, sessionId }));
    } catch (e) {
      console.error('❌ /api/perf/start 失败:', e);
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: e.message || String(e) }));
    }
  }

  if (req.method === 'POST' && pathname === '/api/perf/stop') {
    const body = await parseBody(req);
    const sessionId = body.sessionId;
    const sess = sessionId && sessions.get(sessionId);
    if (!sess) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: '无效 sessionId' }));
    }

    sessions.delete(sessionId);

    try {
      const traceObj = await stopTracingAndGetEvents(sess.cdp);
      const events = traceObj.traceEvents || [];
      try { await sess.page.close(); } catch (_) {}
      try { await sess.browser.disconnect(); } catch (_) {}

      const summary = { totalEvents: events.length };
      res.statusCode = 200;
      return res.end(JSON.stringify({ ok: true, summary }));
    } catch (e) {
      console.error('❌ /api/perf/stop 失败:', e);
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: e.message || String(e) }));
    }
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ ok: false, error: 'Not Found' }));
});

server.listen(PORT, () => {
  console.log(`[perf-controller] 启动: http://127.0.0.1:${PORT}`);
  console.log(`  依赖 Chrome --remote-debugging-port=${CHROME_DEBUG_PORT}`);
  console.log('  POST /api/perf/start { url }');
  console.log('  POST /api/perf/stop  { sessionId }');
});
