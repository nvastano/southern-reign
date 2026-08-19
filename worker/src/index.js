/**
 * Southern Reign Storefront API — Cloudflare Worker
 *
 * Holds every secret (admin password, Google service-account key) server-side.
 * The static site on GitHub Pages only ever talks to this Worker.
 *
 * Secrets (set with `wrangler secret put <NAME>`):
 *   ADMIN_PASSWORD      - password for the admin page
 *   SESSION_SECRET      - random string used to sign admin session tokens
 *   GOOGLE_SA_EMAIL     - service account email
 *   GOOGLE_SA_KEY       - service account private key (PEM, with \n newlines)
 *
 * Vars (set in wrangler.toml):
 *   SHEET_ID            - the Google Sheet id
 *   ALLOWED_ORIGINS     - comma-separated list of site origins
 */

const PRODUCTS_RANGE = 'Products!A2:I';
const ORDERS_RANGE = 'Orders!A:N';
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();

function b64url(bytes) {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const ok = allowed.includes(origin) ? origin : allowed[0] || '';
  return {
    'Access-Control-Allow-Origin': ok,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(data, request, env, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) },
  });
}

/** Constant-time string compare so the password check can't be timed. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* admin session tokens (HMAC-signed, no storage needed)               */
/* ------------------------------------------------------------------ */

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
}

async function issueToken(env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = b64url(enc.encode(JSON.stringify({ exp })));
  const key = await hmacKey(env.SESSION_SECRET);
  const sig = b64url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  return `${payload}.${sig}`;
}

async function verifyToken(token, env) {
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const key = await hmacKey(env.SESSION_SECRET);
  const expected = b64url(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
  if (!safeEqual(sig, expected)) return false;
  try {
    const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof exp === 'number' && exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

/* ------------------------------------------------------------------ */
/* Google Sheets access via service account                            */
/* ------------------------------------------------------------------ */

function pemToArrayBuffer(pem) {
  let text = String(pem || '').trim();

  // Tolerate pasting the whole service-account JSON instead of just the key.
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.private_key) text = String(parsed.private_key);
    } catch { /* fall through and fail with the clearer error below */ }
  }

  // Tolerate the value being pasted with its surrounding JSON quotes.
  text = text.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n');

  if (!text.includes('BEGIN PRIVATE KEY')) {
    throw new Error(
      'GOOGLE_SA_KEY is not a private key. Paste the full "private_key" value ' +
      'from the service-account JSON, including the BEGIN/END lines.'
    );
  }

  // Keep only the base64 payload between the PEM markers, then drop anything
  // outside the base64 alphabet (stray whitespace, newlines, escape artifacts).
  const body = text
    .replace(/-----BEGIN[^-]*-----/, '')
    .replace(/-----END[^-]*-----/, '')
    .replace(/[^A-Za-z0-9+/=]/g, '');

  let bin;
  try {
    bin = atob(body);
  } catch {
    throw new Error(
      'GOOGLE_SA_KEY could not be decoded. It was likely truncated or altered ' +
      'when pasted — re-copy the private_key value from the JSON file.'
    );
  }
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

let cachedToken = null; // { token, exp }

async function googleAccessToken(env) {
  if (cachedToken && cachedToken.exp > Date.now() / 1000 + 60) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = b64url(enc.encode(JSON.stringify({
    iss: env.GOOGLE_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  })));

  const key = await crypto.subtle.importKey(
    'pkcs8', pemToArrayBuffer(env.GOOGLE_SA_KEY),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = b64url(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claim}`)
  ));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${sig}`,
    }),
  });
  if (!res.ok) throw new Error(`Google auth failed: ${await res.text()}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return cachedToken.token;
}

async function sheetsFetch(env, path, init = {}) {
  const token = await googleAccessToken(env);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${env.SHEET_ID}${path}`,
    { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) } }
  );
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  return res.json();
}

/* ------------------------------------------------------------------ */
/* products                                                            */
/* ------------------------------------------------------------------ */

const splitList = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

function rowToProduct(row) {
  return {
    id: row[0] || '',
    name: row[1] || '',
    description: row[2] || '',
    category: row[3] || '',
    price: parseFloat(row[4]) || 0,
    image: row[5] || '',
    sizes: splitList(row[6]),
    colors: splitList(row[7]),
    active: String(row[8] || '').toUpperCase() !== 'FALSE',
  };
}

function productToRow(p) {
  return [
    p.id || '', p.name || '', p.description || '', p.category || '',
    p.price != null ? String(p.price) : '', p.image || '',
    (p.sizes || []).join(', '), (p.colors || []).join(', '),
    p.active === false ? 'FALSE' : 'TRUE',
  ];
}

async function getProducts(env) {
  const data = await sheetsFetch(env, `/values/${encodeURIComponent(PRODUCTS_RANGE)}`);
  return (data.values || []).filter(r => r && r[1]).map(rowToProduct);
}

async function putProducts(env, products) {
  // Clear then rewrite so deletions actually delete.
  await sheetsFetch(env, `/values/${encodeURIComponent(PRODUCTS_RANGE)}:clear`, { method: 'POST', body: '{}' });
  const values = products.map(productToRow);
  if (values.length) {
    await sheetsFetch(
      env,
      `/values/${encodeURIComponent(PRODUCTS_RANGE)}?valueInputOption=USER_ENTERED`,
      { method: 'PUT', body: JSON.stringify({ values }) }
    );
  }
}

/* ------------------------------------------------------------------ */
/* orders                                                              */
/* ------------------------------------------------------------------ */

function sanitizeCell(v) {
  // Stop a submitted value from being interpreted as a Sheets formula.
  const s = String(v == null ? '' : v).slice(0, 500);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

async function createOrder(env, body) {
  const products = await getProducts(env);
  const byId = new Map(products.map(p => [p.id, p]));

  // Bad input is the customer's to fix, so report it as 400 with a real message.
  const reject = msg => { throw Object.assign(new Error(msg), { status: 400 }); };

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) reject('Your order is empty — add at least one item.');
  if (!body.parentName || !body.email) reject('Name and email are required.');

  const orderId = `SR-${Date.now().toString(36).toUpperCase()}`;
  const timestamp = new Date().toISOString();
  const rows = [];
  const lines = [];
  let total = 0;

  for (const item of items) {
    const product = byId.get(item.productId);
    // Price always comes from the sheet, never from the browser.
    if (!product || !product.active) {
      reject('One of the items is no longer available. Please refresh and try again.');
    }
    const qty = Math.max(1, Math.min(99, parseInt(item.qty, 10) || 1));
    const lineTotal = product.price * qty;
    total += lineTotal;

    rows.push([
      orderId, timestamp,
      sanitizeCell(body.parentName), sanitizeCell(body.email), sanitizeCell(body.phone),
      sanitizeCell(body.playerName), sanitizeCell(product.name),
      sanitizeCell(item.size), sanitizeCell(item.color),
      qty, product.price.toFixed(2), lineTotal.toFixed(2),
      sanitizeCell(body.notes), 'NEW',
    ]);

    lines.push({
      name: product.name,
      variant: [item.size, item.color].filter(Boolean).join(' · '),
      qty,
      lineTotal: lineTotal.toFixed(2),
    });
  }

  await sheetsFetch(
    env,
    `/values/${encodeURIComponent(ORDERS_RANGE)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: rows }) }
  );

  return { orderId, total: total.toFixed(2), itemCount: rows.length, lines };
}

/* ------------------------------------------------------------------ */
/* confirmation email (Resend)                                         */
/* ------------------------------------------------------------------ */

const escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function orderEmailHtml(order, body) {
  const rows = order.lines.map(l => `
    <tr>
      <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;">
        <strong>${escapeHtml(l.name)}</strong>
        ${l.variant ? `<br><span style="color:#666;font-size:13px;">${escapeHtml(l.variant)}</span>` : ''}
      </td>
      <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;text-align:center;">${l.qty}</td>
      <td style="padding:10px 8px;border-bottom:1px solid #eef2f7;text-align:right;">$${l.lineTotal}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f7f9fc;font-family:Arial,Helvetica,sans-serif;color:#1a1a2e;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fc;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="background:#143f8a;padding:28px 24px;text-align:center;">
          <div style="color:#C8E428;font-size:22px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">Southern Reign Baseball</div>
          <div style="color:#ffffff;font-size:14px;margin-top:4px;">Team Store</div>
        </td></tr>

        <tr><td style="padding:28px 24px;">
          <p style="margin:0 0 16px;font-size:16px;">Thanks${body.parentName ? `, ${escapeHtml(body.parentName)}` : ''}! We've received your order.</p>

          <p style="margin:0 0 20px;font-size:15px;">
            Confirmation number: <strong>${escapeHtml(order.orderId)}</strong>
          </p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;">
            <tr>
              <th align="left" style="padding:8px;background:#f7f9fc;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#555;">Item</th>
              <th align="center" style="padding:8px;background:#f7f9fc;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#555;">Qty</th>
              <th align="right" style="padding:8px;background:#f7f9fc;font-size:12px;text-transform:uppercase;letter-spacing:1px;color:#555;">Total</th>
            </tr>
            ${rows}
            <tr>
              <td colspan="2" style="padding:14px 8px;font-weight:bold;font-size:16px;">Order Total</td>
              <td style="padding:14px 8px;text-align:right;font-weight:bold;font-size:16px;color:#1C5CBF;">$${escapeHtml(order.total)}</td>
            </tr>
          </table>

          <div style="margin-top:24px;padding:14px 18px;background:#fff8e1;border-left:4px solid #C8E428;font-size:14px;color:#6b5d1f;">
            <strong>What happens next:</strong> We'll collect payment once the full team order is
            finalized. No payment is due right now — we'll be in touch with details.
          </div>

          ${body.playerName ? `<p style="margin:20px 0 0;font-size:14px;color:#555;">Player: ${escapeHtml(body.playerName)}</p>` : ''}
          ${body.notes ? `<p style="margin:6px 0 0;font-size:14px;color:#555;">Your notes: ${escapeHtml(body.notes)}</p>` : ''}
        </td></tr>

        <tr><td style="background:#1a1a2e;padding:20px 24px;text-align:center;color:#ffffff;font-size:12px;">
          Southern Reign Baseball &bull; Spring Hill, Tennessee<br>
          <a href="mailto:SouthernReignBaseball@gmail.com" style="color:#C8E428;">SouthernReignBaseball@gmail.com</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

async function sendOrderEmail(env, order, body) {
  if (!env.RESEND_API_KEY) return { sent: false, reason: 'not configured' };

  const from = env.EMAIL_FROM || 'Southern Reign Baseball <onboarding@resend.dev>';
  const to = [body.email];
  // Copy the team so somebody sees the order without opening the sheet.
  if (env.TEAM_EMAIL) to.push(env.TEAM_EMAIL);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject: `Order ${order.orderId} received — Southern Reign Team Store`,
      html: orderEmailHtml(order, body),
    }),
  });

  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return { sent: true };
}

async function getOrders(env) {
  const data = await sheetsFetch(env, `/values/${encodeURIComponent(ORDERS_RANGE)}`);
  const rows = data.values || [];
  return rows.slice(1).map((r, i) => ({
    // Sheet row number, so an edit can target this exact line. Header is row 1.
    row: i + 2,
    orderId: r[0], timestamp: r[1], parentName: r[2], email: r[3], phone: r[4],
    playerName: r[5], item: r[6], size: r[7], color: r[8],
    qty: r[9], unitPrice: r[10], lineTotal: r[11], notes: r[12], status: r[13],
  })).filter(o => o.orderId);
}

async function updateOrder(env, body) {
  const reject = msg => { throw Object.assign(new Error(msg), { status: 400 }); };

  const row = parseInt(body.row, 10);
  if (!row || row < 2) reject('Invalid order row.');

  const range = `Orders!A${row}:N${row}`;
  const current = await sheetsFetch(env, `/values/${encodeURIComponent(range)}`);
  const existing = (current.values && current.values[0]) || [];

  if (!existing[0]) reject('That order line no longer exists. Refresh and try again.');
  // Guard against the sheet being re-sorted or rows deleted since it was loaded.
  if (body.orderId && existing[0] !== body.orderId) {
    reject('This order has moved in the sheet. Refresh and try again.');
  }

  // Price follows the product, so switching the item re-prices the line.
  const products = await getProducts(env);
  const product = products.find(p => p.name === body.item);
  const unitPrice = product ? product.price : (parseFloat(existing[10]) || 0);
  const qty = Math.max(1, Math.min(99, parseInt(body.qty, 10) || 1));

  const values = [[
    existing[0], existing[1], // order id and timestamp never change
    sanitizeCell(body.parentName), sanitizeCell(body.email), sanitizeCell(body.phone),
    sanitizeCell(body.playerName), sanitizeCell(body.item),
    sanitizeCell(body.size), sanitizeCell(body.color),
    qty, unitPrice.toFixed(2), (unitPrice * qty).toFixed(2),
    sanitizeCell(body.notes), sanitizeCell(body.status || 'NEW'),
  ]];

  await sheetsFetch(
    env,
    `/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values }) }
  );

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* product images (Cloudflare KV)                                      */
/* ------------------------------------------------------------------ */

async function uploadImage(request, env) {
  const bad = msg => { throw Object.assign(new Error(msg), { status: 400 }); };

  if (!env.IMAGES) {
    throw Object.assign(
      new Error('Image uploads are not configured — the IMAGES KV namespace is not bound to this Worker.'),
      { status: 501 }
    );
  }

  const type = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) bad('Please upload a JPG, PNG, WebP, or GIF image.');

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) bad('The uploaded file was empty.');
  if (bytes.byteLength > MAX_IMAGE_BYTES) bad('Images must be 5 MB or smaller.');

  const id = `${crypto.randomUUID()}.${ext}`;
  await env.IMAGES.put(id, bytes, { metadata: { type } });

  return { id, url: `${new URL(request.url).origin}/api/images/${id}` };
}

async function serveImage(id, env, request) {
  if (!env.IMAGES) return new Response('Not found', { status: 404 });

  const { value, metadata } = await env.IMAGES.getWithMetadata(id, { type: 'arrayBuffer' });
  if (!value) return new Response('Not found', { status: 404 });

  return new Response(value, {
    headers: {
      'Content-Type': (metadata && metadata.type) || 'application/octet-stream',
      // Ids are unique per upload, so these never need revalidating.
      'Cache-Control': 'public, max-age=31536000, immutable',
      ...corsHeaders(request, env),
    },
  });
}

/* ------------------------------------------------------------------ */
/* router                                                              */
/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const requireAdmin = async () => {
      if (!(await verifyToken(bearer(request), env))) {
        throw Object.assign(new Error('Not authorized'), { status: 401 });
      }
    };

    try {
      // --- public ---
      if (path === '/api/products' && request.method === 'GET') {
        const products = (await getProducts(env)).filter(p => p.active);
        return json({ products }, request, env);
      }

      if (path.startsWith('/api/images/') && request.method === 'GET') {
        return serveImage(decodeURIComponent(path.slice('/api/images/'.length)), env, request);
      }

      if (path === '/api/orders' && request.method === 'POST') {
        const body = await request.json();
        const result = await createOrder(env, body);

        // The order is already saved. A mail failure must not fail the request
        // or the parent would resubmit and duplicate it.
        let emailed = false;
        try {
          const mail = await sendOrderEmail(env, result, body);
          emailed = mail.sent;
        } catch (mailErr) {
          console.error('Confirmation email failed:', mailErr);
        }

        return json({
          ok: true, orderId: result.orderId, total: result.total,
          itemCount: result.itemCount, emailed,
        }, request, env);
      }

      // --- admin ---
      if (path === '/api/admin/login' && request.method === 'POST') {
        const { password } = await request.json();
        if (!safeEqual(password || '', env.ADMIN_PASSWORD)) {
          return json({ error: 'Incorrect password' }, request, env, 401);
        }
        return json({ token: await issueToken(env) }, request, env);
      }

      if (path === '/api/admin/products' && request.method === 'GET') {
        await requireAdmin();
        return json({ products: await getProducts(env) }, request, env);
      }

      if (path === '/api/admin/products' && request.method === 'PUT') {
        await requireAdmin();
        const { products } = await request.json();
        if (!Array.isArray(products)) throw new Error('products must be an array');
        await putProducts(env, products);
        return json({ ok: true, count: products.length }, request, env);
      }

      if (path === '/api/admin/upload' && request.method === 'POST') {
        await requireAdmin();
        return json(await uploadImage(request, env), request, env);
      }

      if (path === '/api/admin/orders' && request.method === 'GET') {
        await requireAdmin();
        return json({ orders: await getOrders(env) }, request, env);
      }

      if (path === '/api/admin/orders' && request.method === 'PUT') {
        await requireAdmin();
        return json(await updateOrder(env, await request.json()), request, env);
      }

      return json({ error: 'Not found' }, request, env, 404);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      // Never leak internals (including Google errors) to the browser, unless
      // DEBUG_ERRORS is switched on for troubleshooting. Turn it back off after.
      const verbose = status !== 500 || String(env.DEBUG_ERRORS) === 'true';
      const message = verbose ? err.message : 'Something went wrong. Please try again.';
      return json({ error: message }, request, env, status);
    }
  },
};
