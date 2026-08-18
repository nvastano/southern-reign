(function () {
  const API = window.STORE_API;
  const TOKEN_KEY = 'sr_store_token';

  const loginView = document.getElementById('loginView');
  const adminView = document.getElementById('adminView');
  const loginForm = document.getElementById('loginForm');
  const loginMsg = document.getElementById('loginMsg');
  const loginBtn = document.getElementById('loginBtn');
  const adminMsg = document.getElementById('adminMsg');
  const productRows = document.getElementById('productRows');
  const orderRows = document.getElementById('orderRows');
  const productsPanel = document.getElementById('productsPanel');
  const ordersPanel = document.getElementById('ordersPanel');

  let token = sessionStorage.getItem(TOKEN_KEY) || '';
  let orders = [];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function notify(text, kind = 'success') {
    adminMsg.innerHTML = `<div class="store-msg ${kind}">${esc(text)}</div>`;
    if (kind === 'success') setTimeout(() => { adminMsg.innerHTML = ''; }, 4000);
  }

  async function api(path, options = {}) {
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    if (res.status === 401) {
      signOut();
      throw new Error('Your session expired — please sign in again.');
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  /* ---------- auth ---------- */

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    loginMsg.innerHTML = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';
    try {
      const res = await fetch(`${API}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: document.getElementById('password').value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sign in failed');
      token = data.token;
      sessionStorage.setItem(TOKEN_KEY, token);
      showAdmin();
    } catch (err) {
      loginMsg.innerHTML = `<div class="store-msg error">${esc(err.message)}</div>`;
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Sign In';
    }
  });

  function signOut() {
    token = '';
    sessionStorage.removeItem(TOKEN_KEY);
    adminView.style.display = 'none';
    loginView.style.display = 'block';
  }

  function showAdmin() {
    loginView.style.display = 'none';
    adminView.style.display = 'block';
    loadProducts();
  }

  /* ---------- tabs ---------- */

  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const which = tab.dataset.tab;
      if (which === 'logout') return signOut();

      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      productsPanel.style.display = which === 'products' ? 'block' : 'none';
      ordersPanel.style.display = which === 'orders' ? 'block' : 'none';
      if (which === 'orders') loadOrders();
    });
  });

  /* ---------- products ---------- */

  function productRow(p) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" data-f="name" value="${esc(p.name)}" /></td>
      <td><input type="number" data-f="price" step="0.01" min="0" value="${esc(p.price)}" style="min-width:80px;" /></td>
      <td><input type="text" data-f="category" value="${esc(p.category)}" /></td>
      <td><input type="text" data-f="sizes" value="${esc((p.sizes || []).join(', '))}" placeholder="YS, YM, YL, S, M, L" /></td>
      <td><input type="text" data-f="colors" value="${esc((p.colors || []).join(', '))}" placeholder="Navy, White" /></td>
      <td><input type="text" data-f="description" value="${esc(p.description)}" /></td>
      <td><input type="text" data-f="image" value="${esc(p.image)}" placeholder="assets/gear-hat.jpg" /></td>
      <td style="text-align:center;"><input type="checkbox" data-f="active" ${p.active !== false ? 'checked' : ''} /></td>
      <td><button class="btn-sm danger" data-f="remove">&times;</button></td>`;
    tr.dataset.id = p.id || '';
    tr.querySelector('[data-f="remove"]').addEventListener('click', () => tr.remove());
    return tr;
  }

  function collectProducts() {
    return Array.from(productRows.querySelectorAll('tr')).map(tr => {
      const val = f => tr.querySelector(`[data-f="${f}"]`).value.trim();
      const list = f => val(f).split(',').map(s => s.trim()).filter(Boolean);
      return {
        // Keep the existing id so orders already referencing it stay valid.
        id: tr.dataset.id || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        name: val('name'),
        price: parseFloat(val('price')) || 0,
        category: val('category'),
        sizes: list('sizes'),
        colors: list('colors'),
        description: val('description'),
        image: val('image'),
        active: tr.querySelector('[data-f="active"]').checked,
      };
    }).filter(p => p.name);
  }

  async function loadProducts() {
    try {
      const { products } = await api('/api/admin/products');
      productRows.innerHTML = '';
      products.forEach(p => productRows.appendChild(productRow(p)));
      if (!products.length) productRows.appendChild(productRow({ active: true }));
    } catch (err) {
      notify(err.message, 'error');
    }
  }

  document.getElementById('addRowBtn').addEventListener('click', () => {
    productRows.appendChild(productRow({ active: true, price: '' }));
  });

  document.getElementById('saveBtn').addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const products = collectProducts();
      const { count } = await api('/api/admin/products', {
        method: 'PUT',
        body: JSON.stringify({ products }),
      });
      // Re-load so newly generated ids come back from the sheet.
      await loadProducts();
      notify(`Saved ${count} product${count === 1 ? '' : 's'}.`);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  });

  /* ---------- orders ---------- */

  async function loadOrders() {
    orderRows.innerHTML = '<tr><td colspan="12">Loading…</td></tr>';
    try {
      const data = await api('/api/admin/orders');
      orders = data.orders || [];
      if (!orders.length) {
        orderRows.innerHTML = '<tr><td colspan="12">No orders yet.</td></tr>';
        return;
      }
      orderRows.innerHTML = orders.slice().reverse().map(o => `
        <tr>
          <td>${esc(o.orderId)}</td>
          <td>${esc((o.timestamp || '').slice(0, 10))}</td>
          <td>${esc(o.parentName)}</td>
          <td>${esc(o.email)}</td>
          <td>${esc(o.phone)}</td>
          <td>${esc(o.playerName)}</td>
          <td>${esc(o.item)}</td>
          <td>${esc(o.size)}</td>
          <td>${esc(o.color)}</td>
          <td>${esc(o.qty)}</td>
          <td>$${esc(o.lineTotal)}</td>
          <td>${esc(o.notes)}</td>
        </tr>`).join('');
    } catch (err) {
      orderRows.innerHTML = '';
      notify(err.message, 'error');
    }
  }

  document.getElementById('refreshOrdersBtn').addEventListener('click', loadOrders);

  document.getElementById('exportBtn').addEventListener('click', () => {
    if (!orders.length) return notify('No orders to export.', 'error');
    const cols = ['orderId', 'timestamp', 'parentName', 'email', 'phone', 'playerName',
      'item', 'size', 'color', 'qty', 'unitPrice', 'lineTotal', 'notes', 'status'];
    const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const csv = [cols.join(',')]
      .concat(orders.map(o => cols.map(c => cell(o[c])).join(',')))
      .join('\n');

    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'southern-reign-orders.csv';
    a.click();
    URL.revokeObjectURL(url);
  });

  /* ---------- boot ---------- */

  if (token) showAdmin();
})();
