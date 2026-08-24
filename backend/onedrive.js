/**
 * onedrive.js
 * Microsoft OneDrive Cloud-to-Cloud Automated Backup Engine
 * Uses Microsoft Graph API to upload SQL database dumps directly to OneDrive
 */

const DEFAULT_CLIENT_ID = 'd3590ed6-52b3-4102-aeff-aad2292ab01c'; // Standard Public Multi-tenant Client ID or Configurable

// Tables to include in complete SQL database dump
const BACKUP_TABLES = [
  'rooms',
  'categories',
  'items',
  'users',
  'roles',
  'customers',
  'departments',
  'settings',
  'bookings',
  'booking_items',
  'quotations',
  'quotation_items',
  'payment_transactions',
  'timeline_notes',
  'booking_history',
  'cash_shifts',
  'cash_drawer_logs'
];

/**
 * Generate a complete SQL Dump string from database
 */
async function generateDatabaseDumpSql(queryRunner) {
  const lines = [
    '--',
    '-- =========================================================',
    '-- BWORK POS DATABASE BACKUP (SQL DUMP)',
    `-- Export Timestamp: ${new Date().toISOString()}`,
    '-- Target: Microsoft OneDrive Cloud Backup',
    '-- =========================================================',
    '',
    'PRAGMA foreign_keys = OFF;',
    'BEGIN TRANSACTION;'
  ];

  for (const table of BACKUP_TABLES) {
    try {
      const rows = await queryRunner(`SELECT * FROM ${table}`);
      if (!rows || !rows.length) continue;

      lines.push('');
      lines.push(`-- Table: ${table} (${rows.length} rows)`);
      lines.push(`DELETE FROM ${table};`);

      for (const row of rows) {
        const columns = Object.keys(row);
        const values = columns.map(col => {
          const val = row[col];
          if (val === null || val === undefined) return 'NULL';
          if (typeof val === 'number') return val;
          if (typeof val === 'boolean') return val ? 1 : 0;
          // Escape single quotes for SQL string literal
          const str = String(val).replace(/'/g, "''");
          return `'${str}'`;
        });

        lines.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`);
      }
    } catch (e) {
      // Table might not exist or be empty, ignore safely
    }
  }

  lines.push('');
  lines.push('COMMIT;');
  lines.push('PRAGMA foreign_keys = ON;');
  lines.push('');

  return lines.join('\n');
}

/**
 * Generate Microsoft OAuth Authorization URL
 */
function getOneDriveAuthUrl(clientId, redirectUri) {
  const cId = clientId || DEFAULT_CLIENT_ID;
  const scopes = encodeURIComponent('offline_access Files.ReadWrite Files.ReadWrite.All User.Read');
  const rUri = encodeURIComponent(redirectUri);
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${cId}&response_type=code&redirect_uri=${rUri}&scope=${scopes}&response_mode=query&prompt=consent`;
}

/**
 * Exchange Authorization Code for Refresh Token & Access Token
 */
async function exchangeOneDriveCode(code, clientId, clientSecret, redirectUri) {
  const cId = clientId || DEFAULT_CLIENT_ID;
  const params = new URLSearchParams();
  params.append('client_id', cId);
  if (clientSecret) params.append('client_secret', clientSecret);
  params.append('code', code);
  params.append('redirect_uri', redirectUri);
  params.append('grant_type', 'authorization_code');

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  // Fetch connected user profile info
  let userEmail = 'OneDrive User';
  try {
    const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${data.access_token}` }
    });
    const profile = await profileRes.json();
    userEmail = profile.userPrincipalName || profile.mail || profile.displayName || 'OneDrive User';
  } catch (e) {}

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
    user_email: userEmail
  };
}

/**
 * Refresh Access Token using stored Refresh Token
 */
async function refreshOneDriveAccessToken(refreshToken, clientId, clientSecret) {
  const cId = clientId || DEFAULT_CLIENT_ID;
  const params = new URLSearchParams();
  params.append('client_id', cId);
  if (clientSecret) params.append('client_secret', clientSecret);
  params.append('refresh_token', refreshToken);
  params.append('grant_type', 'refresh_token');

  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error_description || data.error);
  }

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_in: data.expires_in
  };
}

/**
 * Upload SQL file directly into OneDrive Folder via Microsoft Graph API
 */
async function uploadSqlToOneDrive(accessToken, fileName, sqlContent, folderName = 'Bwork_POS_Backups') {
  const endpoint = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}:/content`;

  const res = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'text/plain; charset=utf-8'
    },
    body: sqlContent
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OneDrive upload failed (${res.status}): ${errText}`);
  }

  const result = await res.json();
  return {
    id: result.id,
    name: result.name,
    size: result.size,
    webUrl: result.webUrl,
    createdDateTime: result.createdDateTime
  };
}

module.exports = {
  BACKUP_TABLES,
  generateDatabaseDumpSql,
  getOneDriveAuthUrl,
  exchangeOneDriveCode,
  refreshOneDriveAccessToken,
  uploadSqlToOneDrive
};
