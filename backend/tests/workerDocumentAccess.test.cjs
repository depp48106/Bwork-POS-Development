const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync: Database } = require('node:sqlite');

/**
 * High-fidelity D1 Mock backed by node:sqlite DatabaseSync for Cloudflare Worker runtime testing.
 */
function createD1Mock(db) {
  return {
    prepare(query) {
      return {
        bind(...params) {
          return {
            async first(col) {
              const stmt = db.prepare(query);
              const row = stmt.get(...params);
              if (!row) return null;
              if (col) return row[col];
              return row;
            },
            async all() {
              const stmt = db.prepare(query);
              const results = stmt.all(...params);
              return { results, success: true };
            },
            async run() {
              const stmt = db.prepare(query);
              const info = stmt.run(...params);
              return {
                success: true,
                meta: {
                  changes: info.changes,
                  last_row_id: Number(info.lastInsertRowid)
                }
              };
            }
          };
        },
        async first(col) {
          const stmt = db.prepare(query);
          const row = stmt.get();
          if (!row) return null;
          if (col) return row[col];
          return row;
        },
        async all() {
          const stmt = db.prepare(query);
          const results = stmt.all();
          return { results, success: true };
        },
        async run() {
          const stmt = db.prepare(query);
          const info = stmt.run();
          return {
            success: true,
            meta: {
              changes: info.changes,
              last_row_id: Number(info.lastInsertRowid)
            }
          };
        }
      };
    }
  };
}

/**
 * High-fidelity Mock R2 Bucket
 */
function createMockR2Bucket(files = {}) {
  const store = new Map(Object.entries(files));
  return {
    async get(key) {
      if (!store.has(key)) return null;
      const fileData = store.get(key);
      const body = typeof fileData === 'string' ? Buffer.from(fileData) : fileData;
      return {
        body,
        writeHttpMetadata(headers) {
          headers.set('Content-Type', 'image/png');
        }
      };
    },
    async put(key, value) {
      store.set(key, value);
    }
  };
}

function setupTestDb(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT,
      role TEXT,
      permissions TEXT
    );

    CREATE TABLE IF NOT EXISTS roles (
      name TEXT PRIMARY KEY,
      permissions TEXT
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY,
      receipt_number TEXT,
      qr_token TEXT,
      contact TEXT,
      line_user_id TEXT,
      line_user_id_verified INTEGER DEFAULT 0,
      slip_image_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS payment_transactions (
      id INTEGER PRIMARY KEY,
      booking_id INTEGER,
      slip_url TEXT
    );

    CREATE TABLE IF NOT EXISTS tax_invoices (
      id INTEGER PRIMARY KEY,
      booking_id INTEGER,
      file_url TEXT
    );

    CREATE TABLE IF NOT EXISTS slip_verifications (
      id INTEGER PRIMARY KEY,
      booking_id INTEGER,
      slip_image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    INSERT OR REPLACE INTO settings (key, value) VALUES
      ('line_channel_id', '2011136579');
  `);
}

let workerModule = null;
async function getWorker() {
  const devDir = path.resolve(__dirname, '..');
  const workerPath = path.join(devDir, 'worker.js');
  const tempMjs = path.join(devDir, `worker.doc.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.mjs`);
  fs.copyFileSync(workerPath, tempMjs);
  try {
    const fileUrl = 'file:///' + tempMjs.replace(/\\/g, '/');
    workerModule = await import(fileUrl);
  } finally {
    try { fs.unlinkSync(tempMjs); } catch (_) {}
  }
  return workerModule;
}

test('DOC-01: Forged / Fake signature JWT -> cannot open document (403 Access Denied)', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const filePath = 'payment-slips/101/slip_mock_101.png';
  const mockBucket = createMockR2Bucket({
    [filePath]: 'FAKE_IMAGE_DATA_101'
  });

  // Seed booking with LINE user ID UCUSTOMER_101
  db.exec(`INSERT INTO bookings (id, qr_token, contact, line_user_id) VALUES (101, 'qr_token_101', '0812345678', 'UCUSTOMER_101')`);

  let verifyApiCallCount = 0;
  const env = {
    DB: createD1Mock(db),
    BUCKET: mockBucket,
    LINE_CHANNEL_ID: '2011136579',
    verifyLineIdToken: async (token, channelId) => {
      verifyApiCallCount++;
      // Verify API rejects forged token
      return null;
    }
  };

  // Forged JWT with unsigned / fabricated header
  const forgedToken = 'eyJhbGciOiJub25lIn0.eyJpc3MiOiJodHRwczovL2FjY2Vzcy5saW5lLm1lIiwic3ViIjoiVUNVU1RPTUVSXzEwMSJ9.';

  const req = new Request(`http://localhost/uploads/${filePath}`, {
    method: 'GET',
    headers: {
      'X-Line-ID-Token': forgedToken
    }
  });

  const res = await worker.default.fetch(req, env);
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.ok(json.error.includes('Access denied'));

  db.close();
});

test('DOC-02: Verified LINE ID belonging to a DIFFERENT account -> cannot open document (403 Access Denied)', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const filePath = 'payment-slips/102/slip_mock_102.png';
  const mockBucket = createMockR2Bucket({
    [filePath]: 'FAKE_IMAGE_DATA_102'
  });

  // Booking belongs to UCUSTOMER_102
  db.exec(`INSERT INTO bookings (id, qr_token, contact, line_user_id) VALUES (102, 'qr_token_102', '0812345678', 'UCUSTOMER_102')`);

  const env = {
    DB: createD1Mock(db),
    BUCKET: mockBucket,
    LINE_CHANNEL_ID: '2011136579',
    verifyLineIdToken: async (token, channelId) => {
      // Token is validly verified by LINE, but belongs to UATTACKER_DIFFERENT
      return { userId: 'UATTACKER_DIFFERENT', name: 'Other User' };
    }
  };

  const validTokenForOther = 'valid.token.for.attacker';

  const req = new Request(`http://localhost/uploads/${filePath}`, {
    method: 'GET',
    headers: {
      'X-Line-ID-Token': validTokenForOther
    }
  });

  const res = await worker.default.fetch(req, env);
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.ok(json.error.includes('Access denied'));

  db.close();
});

test('DOC-03: Verified LINE ID strictly matching booking.line_user_id -> can open document (200 OK)', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const filePath = 'payment-slips/103/slip_mock_103.png';
  const mockBucket = createMockR2Bucket({
    [filePath]: 'CONFIDENTIAL_SLIP_BINARY_103'
  });

  // Booking belongs to UVERIFIED_103
  db.exec(`INSERT INTO bookings (id, qr_token, contact, line_user_id) VALUES (103, 'qr_token_103', '0812345678', 'UVERIFIED_103')`);

  let verifyCallReceivedChannel = null;
  const env = {
    DB: createD1Mock(db),
    BUCKET: mockBucket,
    LINE_CHANNEL_ID: '2011136579',
    verifyLineIdToken: async (token, channelId) => {
      verifyCallReceivedChannel = channelId;
      if (token === 'valid.token.for.customer103') {
        return { userId: 'UVERIFIED_103', name: 'Verified Customer 103' };
      }
      return null;
    }
  };

  const req = new Request(`http://localhost/uploads/${filePath}`, {
    method: 'GET',
    headers: {
      'X-Line-ID-Token': 'valid.token.for.customer103'
    }
  });

  const res = await worker.default.fetch(req, env);
  assert.equal(res.status, 200);
  const bodyText = await res.text();
  assert.equal(bodyText, 'CONFIDENTIAL_SLIP_BINARY_103');
  // Verified channel ID was retrieved from server settings
  assert.equal(verifyCallReceivedChannel, '2011136579');

  db.close();
});

test('DOC-04: Correct booking token (X-Booking-Token) -> opens document WITHOUT calling LINE Verify API', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const filePath = 'payment-slips/104/slip_mock_104.png';
  const mockBucket = createMockR2Bucket({
    [filePath]: 'CONFIDENTIAL_SLIP_BINARY_104'
  });

  db.exec(`INSERT INTO bookings (id, qr_token, contact, line_user_id) VALUES (104, 'valid_booking_token_xyz', '0812345678', 'UCUSTOMER_104')`);

  let lineVerifyCalled = false;
  const env = {
    DB: createD1Mock(db),
    BUCKET: mockBucket,
    LINE_CHANNEL_ID: '2011136579',
    verifyLineIdToken: async () => {
      lineVerifyCalled = true;
      throw new Error('LINE Verify API should NOT be called when booking token is valid');
    }
  };

  const req = new Request(`http://localhost/uploads/${filePath}`, {
    method: 'GET',
    headers: {
      'X-Booking-Token': 'valid_booking_token_xyz'
    }
  });

  const res = await worker.default.fetch(req, env);
  assert.equal(res.status, 200);
  const bodyText = await res.text();
  assert.equal(bodyText, 'CONFIDENTIAL_SLIP_BINARY_104');

  // Strictly verify LINE Verify API was NOT called!
  assert.equal(lineVerifyCalled, false);

  db.close();
});

test('DOC-05: Real fetch to official LINE Verify ID Token API mocked -> verifies sub against booking', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const filePath = 'tax-invoices/105/tax_invoice_105.pdf';
  const mockBucket = createMockR2Bucket({
    [filePath]: 'PDF_INVOICE_CONTENT_105'
  });

  db.exec(`INSERT INTO bookings (id, qr_token, contact, line_user_id) VALUES (105, 'qr_token_105', '0812345678', 'UTARGET_LINE_USER_105')`);

  const oldFetch = globalThis.fetch;
  let lineVerifyApiHit = false;

  try {
    globalThis.fetch = async (url, options) => {
      if (url === 'https://api.line.me/oauth2/v2.1/verify') {
        lineVerifyApiHit = true;
        const bodyStr = String(options?.body || '');
        if (bodyStr.includes('id_token=real_header.real_payload.real_sig')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              iss: 'https://access.line.me',
              sub: 'UTARGET_LINE_USER_105',
              aud: '2011136579',
              exp: Math.floor(Date.now() / 1000) + 3600
            })
          };
        }
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'invalid_request' })
        };
      }
      return oldFetch(url, options);
    };

    const env = {
      DB: createD1Mock(db),
      BUCKET: mockBucket,
      LINE_CHANNEL_ID: '2011136579'
      // No env.verifyLineIdToken -> falls through to real fetch!
    };

    const req = new Request(`http://localhost/uploads/${filePath}`, {
      method: 'GET',
      headers: {
        'X-Line-ID-Token': 'real_header.real_payload.real_sig'
      }
    });

    const res = await worker.default.fetch(req, env);
    assert.equal(res.status, 200);
    const bodyText = await res.text();
    assert.equal(bodyText, 'PDF_INVOICE_CONTENT_105');
    assert.equal(lineVerifyApiHit, true);
  } finally {
    globalThis.fetch = oldFetch;
    db.close();
  }
});

test('DOC-06: Unauthenticated request -> 401 Authentication required', async () => {
  const db = new Database(':memory:');
  setupTestDb(db);
  const worker = await getWorker();

  const filePath = 'payment-slips/106/slip_106.png';
  const mockBucket = createMockR2Bucket({
    [filePath]: 'SLIP_106'
  });

  db.exec(`INSERT INTO bookings (id, qr_token, contact, line_user_id) VALUES (106, 'qr_token_106', '0812345678', 'ULINE_106')`);

  const env = {
    DB: createD1Mock(db),
    BUCKET: mockBucket
  };

  const req = new Request(`http://localhost/uploads/${filePath}`, {
    method: 'GET'
  });

  const res = await worker.default.fetch(req, env);
  assert.equal(res.status, 401);
  const json = await res.json();
  assert.ok(json.error.includes('Authentication required'));

  db.close();
});
