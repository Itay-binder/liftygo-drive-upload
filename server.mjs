/**
 * העלאת תמונות לדרייב – Cloud Run (מחוץ לוורדפרס / Cloudflare).
 * גוף JSON זהה ל־WordPress: customer_name, order_date, order_id?, files: [{ base64, filename, mime_type }]
 */
import express from 'express';
import { Readable } from 'node:stream';
import { google } from 'googleapis';

const PORT = process.env.PORT || 8080;
const DRIVE_ROOT_FOLDER_ID = (process.env.DRIVE_ROOT_FOLDER_ID || '').trim();
const UPLOAD_SECRET = (process.env.UPLOAD_SECRET || '').trim();

/** OAuth משתמש (Gmail) — פותר quota של SA בתוך My Drive של משתמש */
const OAUTH_CLIENT_ID = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
const OAUTH_CLIENT_SECRET = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
const OAUTH_REFRESH_TOKEN = (process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '').trim();

function usesGmailUserOAuth() {
  return Boolean(OAUTH_CLIENT_ID && OAUTH_CLIENT_SECRET && OAUTH_REFRESH_TOKEN);
}

function parseServiceAccountJson() {
  let raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  if (raw.startsWith('"')) {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function corsHeaders(req) {
  const origin = req.headers.origin || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Liftygo-Upload-Secret',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * אם מוגדרים שלושת משתני ה־OAuth — משתמשים ב־Gmail (מכסת האחסון של המשתמש).
 * אחרת — Service Account (מתאים ל־Shared drive וכו').
 */
async function getDriveClient() {
  if (usesGmailUserOAuth()) {
    const oauth2 = new google.auth.OAuth2(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
    oauth2.setCredentials({ refresh_token: OAUTH_REFRESH_TOKEN });
    return google.drive({
      version: 'v3',
      auth: oauth2,
      timeout: 120000,
    });
  }

  const credentials = parseServiceAccountJson();
  if (!credentials || typeof credentials !== 'object') {
    throw new Error(
      'Missing Drive auth: set GOOGLE_SERVICE_ACCOUNT_JSON, or set all of GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN (Gmail user).',
    );
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({
    version: 'v3',
    auth,
    timeout: 120000,
  });
}

function decodeBase64File(base64) {
  let data = base64;
  if (typeof data !== 'string') return null;
  if (data.includes(',')) {
    data = data.split(',', 2)[1];
  }
  data = data.replace(/\s+/g, '');
  // URL-safe base64 from some clients
  data = data.replace(/-/g, '+').replace(/_/g, '/');
  const missing = (4 - (data.length % 4)) % 4;
  if (missing) data += '='.repeat(missing);
  const buf = Buffer.from(data, 'base64');
  if (!buf.length) return null;
  return buf;
}

/** שמות קבצים בטוחים לדרייב (UTF-8 נשמר; תווים אסורים מוסרים) */
function sanitizeDriveFilename(name) {
  const base = (name || '').toString().trim() || 'file';
  const cleaned = base.replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 200);
}

const app = express();
app.use(express.json({ limit: '52mb' }));

app.options('/create-folder-and-upload', (req, res) => {
  Object.entries(corsHeaders(req)).forEach(([k, v]) => res.setHeader(k, v));
  res.status(204).end();
});

app.post('/create-folder-and-upload', async (req, res) => {
  Object.entries(corsHeaders(req)).forEach(([k, v]) => res.setHeader(k, v));

  const incomingSecret = (req.get('x-liftygo-upload-secret') || '').trim();
  if (UPLOAD_SECRET && incomingSecret !== UPLOAD_SECRET) {
    return res.status(401).json({
      success: false,
      error: 'unauthorized',
      message: 'Invalid or missing X-Liftygo-Upload-Secret',
    });
  }

  if (!DRIVE_ROOT_FOLDER_ID) {
    return res.status(500).json({
      success: false,
      error: 'config',
      message: 'Missing DRIVE_ROOT_FOLDER_ID',
    });
  }

  const body = req.body || {};
  const customerName = (body.customer_name || '').toString().trim();
  const orderDate = (body.order_date || '').toString().trim();
  const orderId = (body.order_id || '').toString().trim();
  const files = Array.isArray(body.files) ? body.files : [];

  if (!customerName || !orderDate) {
    return res.status(400).json({
      success: false,
      error: 'missing_parameters',
      message: 'customer_name and order_date required',
    });
  }

  // בלי קבצים – לא יוצרים תיקייה ריקה (מונע בלבול כמו "תיקייה בלי תמונה")
  if (files.length === 0) {
    console.warn('[Drive] no files in body; keys:', Object.keys(body));
    return res.status(400).json({
      success: false,
      error: 'no_files',
      message: 'No files in request. Check that the browser sends a non-empty files array.',
      hint: 'Open DevTools → Network → create-folder-and-upload → Payload and confirm files has objects with base64, filename, mime_type.',
    });
  }

  const pickFileFields = (f) => ({
    base64: f.base64 ?? f.Base64,
    filename: (f.filename ?? f.fileName ?? '').toString().trim(),
    mime_type: (f.mime_type ?? f.mimeType ?? 'application/octet-stream').toString().split(';')[0].trim(),
  });

  const decodable = files.filter((f) => {
    const { base64, filename } = pickFileFields(f);
    const buf = base64 ? decodeBase64File(base64) : null;
    return !!(buf && filename);
  });
  if (decodable.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'no_valid_files',
      message: 'files array present but nothing decoded (check base64, filename, mime_type).',
      files_received: files.length,
    });
  }

  let folderName = `${customerName} - ${orderDate}`;
  if (orderId) folderName += ` - ${orderId}`;

  let drive;
  try {
    drive = await getDriveClient();
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: 'auth_config',
      message: e.message || 'Drive auth failed',
    });
  }

  let folderId;
  try {
    const folder = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [DRIVE_ROOT_FOLDER_ID],
      },
      fields: 'id',
      supportsAllDrives: true,
    });
    folderId = folder.data.id;
  } catch (e) {
    console.error('[Drive] create folder', e.message);
    return res.status(500).json({
      success: false,
      error: 'folder_creation_failed',
      message: e.message || 'Folder creation failed',
    });
  }

  try {
    await drive.permissions.create({
      fileId: folderId,
      requestBody: { type: 'anyone', role: 'reader' },
      fields: 'id',
      supportsAllDrives: true,
    });
  } catch (e) {
    console.warn('[Drive] share folder failed (non-fatal):', e.message);
  }

  const uploaded = [];
  const uploadErrors = [];
  let lastErr = null;

  for (let i = 0; i < files.length; i++) {
    const f = pickFileFields(files[i]);
    const filename = f.filename;
    const mimeType = f.mime_type || 'application/octet-stream';
    const buf = f.base64 ? decodeBase64File(f.base64) : null;
    if (!buf || !filename) {
      uploadErrors.push({
        index: i,
        filename: filename || '(empty)',
        step: 'decode_or_missing_fields',
        message: !filename ? 'missing filename' : 'base64 decode failed or empty',
      });
      continue;
    }

    try {
      const safeName = sanitizeDriveFilename(filename);
      const created = await drive.files.create({
        requestBody: {
          name: safeName,
          parents: [folderId],
          mimeType,
        },
        media: {
          mimeType,
          body: Readable.from(buf),
        },
        fields: 'id',
        supportsAllDrives: true,
      });
      const id = created.data.id;
      uploaded.push({
        filename: safeName,
        file_id: id,
        file_url: `https://drive.google.com/file/d/${id}/view`,
      });
    } catch (e) {
      const apiDetail = e.response?.data ? JSON.stringify(e.response.data) : '';
      const msg = apiDetail ? `${e.message} | ${apiDetail}` : e.message;
      console.error('[Drive] upload file', filename, msg);
      lastErr = { code: 'upload_failed', message: msg };
      uploadErrors.push({ index: i, filename, step: 'drive_api', message: msg });
    }
  }

  if (uploaded.length === 0) {
    try {
      await drive.files.update({
        fileId: folderId,
        requestBody: { trashed: true },
        supportsAllDrives: true,
      });
      console.warn('[Drive] trashed empty folder (no file uploads succeeded)', folderId);
    } catch (e) {
      console.error('[Drive] failed to trash empty folder', folderId, e.message);
    }
    return res.status(500).json({
      success: false,
      error: 'upload_failed',
      message: 'Folder was created but Drive did not accept any file upload. Check upload_errors and service account permissions on the parent folder.',
      upload_error: lastErr,
      upload_errors: uploadErrors.length ? uploadErrors : undefined,
      files_attempted: files.length,
    });
  }

  const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;

  return res.status(200).json({
    success: true,
    folder_id: folderId,
    folder_name: folderName,
    folder_url: folderUrl,
    files_count: uploaded.length,
    files: uploaded,
    files_attempted: files.length,
    upload_success: true,
    upload_errors: uploadErrors.length ? uploadErrors : undefined,
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  const mode = usesGmailUserOAuth() ? 'Gmail user OAuth' : 'Service Account JSON';
  console.log(`Listening on ${PORT}; Drive auth: ${mode}`);
});
