(function () {
  'use strict';

  const form = document.getElementById('lwForm');
  const rowsHost = document.getElementById('lwRows');
  const tpl = document.getElementById('lwRowTpl');
  const addBtn = document.getElementById('lwAddRow');
  const alertBox = document.getElementById('lwAlert');
  const submitBtn = document.getElementById('lwSubmit');

  const DEFAULT_DRIVE_URL =
    'https://liftygo-drive-upload-163624355434.europe-west1.run.app/create-folder-and-upload';

  function cfg() {
    const w = typeof window !== 'undefined' ? window : {};
    const url = String(w.LIFTYGO_DRIVE_API_URL || DEFAULT_DRIVE_URL).trim();
    const secret = String(w.LIFTYGO_UPLOAD_SECRET || '').trim();
    const makeUrl = String(w.LIFTYGO_MAKE_WEBHOOK_URL || '').trim();
    const sendSecret = secret && /\.run\.app\b/i.test(url);
    return { url, secret: sendSecret ? secret : '', makeUrl };
  }

  function showAlert(text, kind) {
    alertBox.hidden = false;
    alertBox.textContent = text;
    alertBox.dataset.kind = kind || 'err';
  }

  function clearAlert() {
    alertBox.hidden = true;
    alertBox.textContent = '';
    delete alertBox.dataset.kind;
  }

  function compressImageToDataUrl(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        reject(new Error('not_image'));
        return;
      }
      const img = new Image();
      const blobUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(blobUrl);
        let w = img.naturalWidth || img.width;
        let h = img.naturalHeight || img.height;
        if (!w || !h) {
          reject(new Error('bad_dimensions'));
          return;
        }
        const scale = Math.min(1, maxEdge / Math.max(w, h));
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        reject(new Error('image_load_error'));
      };
      img.src = blobUrl;
    });
  }

  function extractBase64Parts(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      return { base64: null, mime: null };
    }
    const i = dataUrl.indexOf(';base64,');
    if (i === -1) return { base64: null, mime: null };
    const meta = dataUrl.slice(5, i);
    const mime = (meta.split(';')[0] || '').trim().toLowerCase();
    const base64 = dataUrl.slice(i + ';base64,'.length).replace(/\s/g, '');
    if (!base64) return { base64: null, mime: null };
    return { base64, mime };
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(r.error || new Error('read_failed'));
      r.readAsDataURL(file);
    });
  }

  /** מצב מדיה לשורה – לא תלוי ב-src של תמונה בזמן שליחה */
  function setRowMedia(row, { base64, mime, previewDataUrl }) {
    row._lwMedia = { base64, mime, previewDataUrl };
  }

  function getRowMedia(row) {
    return row._lwMedia || null;
  }

  function attachRow(row) {
    const nameEl = row.querySelector('[data-item-name]');
    const qtyEl = row.querySelector('[data-item-qty]');
    const fileEl = row.querySelector('[data-item-file]');
    const pickBtn = row.querySelector('[data-pick]');
    const thumb = row.querySelector('[data-thumb]');
    const delBtn = row.querySelector('[data-del]');

    pickBtn.addEventListener('click', () => fileEl.click());

    fileEl.addEventListener('change', async () => {
      const file = fileEl.files && fileEl.files[0];
      if (!file) return;
      clearAlert();

      let dataUrl = '';
      try {
        if (file.type.startsWith('image/')) {
          try {
            dataUrl = await compressImageToDataUrl(file, 1400, 0.82);
          } catch {
            dataUrl = await readFileAsDataUrl(file);
          }
        } else {
          dataUrl = await readFileAsDataUrl(file);
        }
      } catch {
        showAlert('לא הצלחנו לקרוא את הקובץ. נסה תמונה אחרת.');
        fileEl.value = '';
        return;
      }

      const { base64, mime } = extractBase64Parts(dataUrl);
      if (!base64 || !mime) {
        showAlert('פורמט קובץ לא נתמך אחרי הקריאה.');
        fileEl.value = '';
        return;
      }

      setRowMedia(row, { base64, mime, previewDataUrl: dataUrl });
      thumb.src = dataUrl;
      thumb.hidden = false;
    });

    delBtn.addEventListener('click', () => {
      row.remove();
      syncFirstRowRequired();
    });
  }

  function addRow() {
    const node = tpl.content.firstElementChild.cloneNode(true);
    rowsHost.appendChild(node);
    attachRow(node);
    syncFirstRowRequired();
  }

  function syncFirstRowRequired() {
    const rows = rowsHost.querySelectorAll('[data-lw-row]');
    rows.forEach((r, idx) => {
      const nameEl = r.querySelector('[data-item-name]');
      if (!nameEl) return;
      if (rows.length === 1) nameEl.setAttribute('required', 'required');
      else if (idx === 0) nameEl.setAttribute('required', 'required');
      else if (!nameEl.value.trim()) nameEl.removeAttribute('required');
    });
  }

  function collectFilesForDrive() {
    const rows = Array.from(rowsHost.querySelectorAll('[data-lw-row]'));
    const files = [];
    rows.forEach((row, index) => {
      const name = (row.querySelector('[data-item-name]')?.value || '').trim();
      const qty = (row.querySelector('[data-item-qty]')?.value || '').trim();
      if (!name || !qty) return;
      const media = getRowMedia(row);
      if (!media || !media.base64 || !media.mime) return;
      const ext = (media.mime.split('/')[1] || 'jpg').split(';')[0].trim();
      const safe = name.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '') || `item_${index + 1}`;
      files.push({
        base64: media.base64,
        filename: `${safe}_${index + 1}.${ext}`,
        mime_type: media.mime.split(';')[0].trim().toLowerCase(),
      });
    });
    return files;
  }

  function buildItemsSummary() {
    const rows = Array.from(rowsHost.querySelectorAll('[data-lw-row]'));
    const parts = [];
    rows.forEach((row, index) => {
      const name = (row.querySelector('[data-item-name]')?.value || '').trim();
      const qty = (row.querySelector('[data-item-qty]')?.value || '').trim();
      if (!name) return;
      const has = !!getRowMedia(row)?.base64;
      parts.push(`${qty} יח' - ${name}${has ? ' (עם תמונה)' : ''}`);
    });
    return parts.join(' | ');
  }

  async function createFolderAndUpload(customerName, orderDate, files, orderId) {
    const { url, secret } = cfg();
    const body = {
      customer_name: customerName,
      order_date: orderDate,
      order_id: orderId || '',
      files,
    };
    const headers = { 'Content-Type': 'application/json' };
    if (secret) headers['X-Liftygo-Upload-Secret'] = secret;

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const err = new Error(json?.message || `HTTP ${res.status}`);
      err.details = json;
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async function postMake(payload) {
    const { makeUrl } = cfg();
    if (!makeUrl) return;
    await fetch(makeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }

  addBtn.addEventListener('click', () => addRow());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();

    if (!form.reportValidity()) return;

    const name = document.getElementById('lwName').value.trim();
    const phone = document.getElementById('lwPhone').value.trim();
    const date = document.getElementById('lwDate').value;
    const orderId =
      phone.replace(/\D/g, '') +
      '-' +
      new Date()
        .toISOString()
        .replace(/[-:TZ.]/g, '')
        .slice(0, 14);

    const files = collectFilesForDrive();
    if (files.length === 0) {
      showAlert('אין קבצים לשליחה: צרף תמונה לשורה עם שם וכמות, או וודא שהשורה לא ריקה.');
      return;
    }

    submitBtn.disabled = true;
    try {
      const drive = await createFolderAndUpload(name, date, files, orderId);
      const okCount = Number(drive?.files_count || 0);
      if (!drive?.folder_id || okCount < 1) {
        showAlert('התקבלה תשובה חריגה מהשרת (אין folder_id או files_count).');
        return;
      }

      showAlert(
        `הצלחה: נוצרה תיקייה והועלו ${okCount} קבצים.\n${drive.folder_url || ''}`,
        'ok',
      );

      const payload = {
        move_type: 'הובלה קטנה',
        name,
        phone,
        date,
        order_id: orderId,
        items_text: buildItemsSummary(),
        drive_folder_url: drive.folder_url,
        drive_folder_id: drive.folder_id,
        drive_folder_name: drive.folder_name,
        drive_files_count: okCount,
      };
      await postMake(payload);
    } catch (err) {
      const d = err.details;
      let msg = err.message || 'שגיאה לא ידועה';
      if (d?.upload_errors && Array.isArray(d.upload_errors)) {
        msg +=
          '\n\nפרטי Drive:\n' +
          d.upload_errors.map((x) => `- ${x.filename}: ${x.message}`).join('\n');
      } else if (d?.message) {
        msg += '\n\n' + JSON.stringify(d, null, 2);
      }
      showAlert(msg);
    } finally {
      submitBtn.disabled = false;
    }
  });

  addRow();
})();
