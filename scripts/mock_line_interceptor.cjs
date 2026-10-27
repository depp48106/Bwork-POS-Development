const fs = require('fs');
const path = require('path');

const originalFetch = globalThis.fetch;
const logPath = path.join(__dirname, 'captured_mock_line.jsonl');

try {
  if (fs.existsSync(logPath)) {
    fs.unlinkSync(logPath);
  }
} catch (_) {}

globalThis.fetch = async function(url, options = {}) {
  const urlStr = String(url);
  if (urlStr.includes('api.line.me')) {
    console.log(`[MOCK LINE INTERCEPTOR] Intercepted call to ${urlStr}`);
    let parsedBody = null;
    try {
      if (options.body) {
        parsedBody = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
      }
    } catch (_) {
      parsedBody = options.body;
    }
    const record = {
      timestamp: new Date().toISOString(),
      url: urlStr,
      headers: options.headers,
      body: parsedBody
    };

    try {
      fs.appendFileSync(logPath, JSON.stringify(record) + '\n');
    } catch (e) {
      console.error('[MOCK LINE INTERCEPTOR] Failed to append log:', e.message);
    }

    const mockStatus = parseInt(process.env.MOCK_LINE_STATUS || '200', 10);
    const isOk = mockStatus >= 200 && mockStatus < 300;

    return new Response(JSON.stringify({
      message: isOk ? 'Success (Mocked LINE)' : 'Error (Mocked LINE)',
      status: mockStatus
    }), {
      status: mockStatus,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return originalFetch.apply(this, arguments);
};

console.log('[MOCK LINE INTERCEPTOR] Initialized successfully. Live LINE calls are strictly blocked.');
