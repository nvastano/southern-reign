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
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
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

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new Error('Order has no items');
  if (!body.parentName || !body.email) throw new Error('Name and email are required');

  const orderId = `SR-${Date.now().toString(36).toUpperCase()}`;
  const timestamp = new Date().toISOString();
  const rows = [];
  let total = 0;

  for (const item of items) {
    const product = byId.get(item.productId);
    // Price always comes from the sheet, never from the browser.
    if (!product || !product.active) throw new Error(`Unknown product: ${item.productId}`);
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
  }

  await sheetsFetch(
    env,
    `/values/${encodeURIComponent(ORDERS_RANGE)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: rows }) }
  );

  return { orderId, total: total.toFixed(2), itemCount: rows.length };
}

async function getOrders(env) {
  const data = await sheetsFetch(env, `/values/${encodeURIComponent(ORDERS_RANGE)}`);
  const rows = data.values || [];
  return rows.slice(1).filter(r => r && r[0]).map(r => ({
    orderId: r[0], timestamp: r[1], parentName: r[2], email: r[3], phone: r[4],
    playerName: r[5], item: r[6], size: r[7], color: r[8],
    qty: r[9], unitPrice: r[10], lineTotal: r[11], notes: r[12], status: r[13],
  }));
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

      if (path === '/api/orders' && request.method === 'POST') {
        const result = await createOrder(env, await request.json());
        return json({ ok: true, ...result }, request, env);
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

      if (path === '/api/admin/orders' && request.method === 'GET') {
        await requireAdmin();
        return json({ orders: await getOrders(env) }, request, env);
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
