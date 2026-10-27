const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ARTIFACT_DIR = 'C:/Users/Runrasa.P/.gemini/antigravity/brain/03721993-8ed4-4f8b-a41b-db0f7e984101';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function capture() {
  const loginRes = await fetch('https://bwork-pos-api.ohnatza74185-ky.workers.dev/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const { token, user } = await loginRes.json();

  const tempProfile = path.join(ARTIFACT_DIR, 'scratch', 'chrome_prod_verify_profile3');
  try { fs.rmSync(tempProfile, { recursive: true, force: true }); } catch (e) {}
  fs.mkdirSync(tempProfile, { recursive: true });

  const chromeProc = spawn(CHROME_PATH, [
    '--headless=new',
    '--remote-debugging-port=9226',
    '--user-data-dir=' + tempProfile,
    '--window-size=1280,900',
    '--disable-gpu',
    '--no-first-run',
    'about:blank'
  ]);

  await new Promise(r => setTimeout(r, 2000));

  const pages = await new Promise((resolve, reject) => {
    http.get('http://localhost:9226/json', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const targetPage = pages.find(p => p.type === 'page');
  const ws = new WebSocket(targetPage.webSocketDebuggerUrl);
  let msgId = 1;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = msgId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');

  try {
    await send('Page.navigate', { url: 'https://bwork-pos.pages.dev' });
    await new Promise(r => setTimeout(r, 2500));

    await send('Runtime.evaluate', {
      expression: 'localStorage.setItem("pos_token", ' + JSON.stringify(token) + ');' +
                  'localStorage.setItem("token", ' + JSON.stringify(token) + ');' +
                  'localStorage.setItem("pos_user", ' + JSON.stringify(JSON.stringify(user)) + ');'
    });

    await send('Page.navigate', { url: 'https://bwork-pos.pages.dev' });
    await new Promise(r => setTimeout(r, 3500));

    // Find and click the Booking Management button
    await send('Runtime.evaluate', {
      expression: `
        const spans = Array.from(document.querySelectorAll('span'));
        const span = spans.find(s => s.textContent.trim() === 'Booking Management');
        if (span) {
          const btn = span.closest('button');
          if (btn) btn.click();
        }
      `
    });
    await new Promise(r => setTimeout(r, 3500));

    const mgmtScreenshot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'production_booking_management.png'), Buffer.from(mgmtScreenshot.data, 'base64'));
    console.log('Saved Booking Management screenshot: production_booking_management.png');
  } finally {
    try { ws.close(); } catch (e) {}
    try { chromeProc.kill(); } catch (e) {}
  }
}

capture().catch(err => { console.error(err); process.exit(1); });
