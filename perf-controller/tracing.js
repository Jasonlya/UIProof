const http = require('http');
const puppeteer = require('puppeteer-core');

async function getWsEndpoint(port) {
  const body = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
  const json = JSON.parse(body);
  return json.webSocketDebuggerUrl;
}

async function getPageSession(browser, targetUrl) {
  const pages = await browser.pages();
  const clean = (u) => (u || '').split('#')[0];
  const page = pages.find((p) => clean(p.url()) === clean(targetUrl));
  if (!page) throw new Error(`未找到匹配页面: ${targetUrl}`);
  const cdp = await page.target().createCDPSession();
  return { page, cdp };
}

async function startTracingOnPage(port, targetUrl) {
  const wsEndpoint = await getWsEndpoint(port);
  const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
  const { page, cdp } = await getPageSession(browser, targetUrl);

  const { categories } = await cdp.send('Tracing.getCategories');
  const list = categories || [];

  await cdp.send('Tracing.start', {
    traceConfig: {
      recordMode: 'recordUntilFull',
      traceBufferSizeInKb: 64 * 1024,
      includedCategories: list.length ? list : undefined,
    },
    transferMode: 'ReturnAsStream',
    streamFormat: 'json',
  });

  return { browser, page, cdp };
}

async function stopTracingAndGetEvents(cdp) {
  return new Promise((resolve, reject) => {
    const onComplete = async (params) => {
      try {
        cdp.off('Tracing.tracingComplete', onComplete);
        const handle = params.stream;
        if (!handle) return resolve({ traceEvents: [] });

        const chunks = [];
        while (true) {
          const { data, eof } = await cdp.send('IO.read', { handle });
          if (data) chunks.push(Buffer.from(data, 'base64'));
          if (eof) break;
        }
        await cdp.send('IO.close', { handle });

        const jsonStr = Buffer.concat(chunks).toString('utf8');
        let obj;
        try {
          obj = JSON.parse(jsonStr);
        } catch (_) {
          obj = { traceEvents: [] };
        }
        if (!obj.traceEvents && Array.isArray(obj)) obj = { traceEvents: obj };
        resolve(obj || { traceEvents: [] });
      } catch (e) {
        reject(e);
      }
    };

    cdp.on('Tracing.tracingComplete', onComplete);
    cdp.send('Tracing.end').catch(reject);
  });
}

module.exports = {
  startTracingOnPage,
  stopTracingAndGetEvents,
};
