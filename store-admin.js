(function () {
  const API = window.STORE_API;
  const TOKEN_KEY = 'sr_store_token';

  const $ = id => document.getElementById(id);

  const loginView = $('loginView');
  const adminView = $('adminView');
  const loginForm = $('loginForm');
  const loginMsg = $('loginMsg');
  const loginBtn = $('loginBtn');
  const adminMsg = $('adminMsg');
  const productList = $('productList');
  const orderRows = $('orderRows');
  const productsPanel = $('productsPanel');
  const ordersPanel = $('ordersPanel');

  const modal = $('productModal');
  const modalTitle = $('modalTitle');
  const modalMsg = $('modalMsg');
  const modalDelete = $('modalDelete');

  let token = sessionStorage.getItem(TOKEN_KEY) || '';
  let products = [];
  let orders = [];
  let editingIndex = -1; // -1 means we're adding a new product

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => '$' + (Number(n) || 0).toFixed(2);

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

  /* ---------------- auth ---------------- */

  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    loginMsg.innerHTML = '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';
    try {
      const res = await fetch(`${API}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: $('password').value }),
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
    closeModal();
    adminView.style.display = 'none';
    loginView.style.display = 'block';
    $('password').value = '';
  }

  function showAdmin() {
    loginView.style.display = 'none';
    adminView.style.display = 'block';
    loadProducts();
  }

  /* ---------------- tabs ---------------- */

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

  /* ---------------- product list ---------------- */

  function renderProducts() {
    if (!products.length) {
      productList.innerHTML = `
        <div class="empty-state">
          <p>No products yet.</p>
          <p class="empty-sub">Click <strong>+ Add Product</strong> to create your first item.</p>
        </div>`;
      return;
    }

    productList.innerHTML = products.map((p, i) => {
      const bits = [];
      if (p.sizes && p.sizes.length) bits.push(`${p.sizes.length} size${p.sizes.length === 1 ? '' : 's'}`);
      if (p.colors && p.colors.length) bits.push(p.colors.join(', '));
      if (p.category) bits.unshift(p.category);

      return `
        <div class="product-row${p.active === false ? ' inactive' : ''}" data-index="${i}" role="button" tabindex="0">
          ${p.image
            ? `<img class="row-thumb" src="${esc(p.image)}" alt="" />`
            : `<div class="row-thumb placeholder">&#9918;</div>`}
          <div class="row-main">
            <div class="row-name">${esc(p.name)}</div>
            <div class="row-meta">${esc(bits.join(' · '))}</div>
          </div>
          <div class="row-right">
            <div class="row-price">${money(p.price)}</div>
            ${p.active === false ? '<span class="badge-off">Hidden</span>' : ''}
          </div>
          <span class="row-chevron">&rsaquo;</span>
        </div>`;
    }).join('');

    productList.querySelectorAll('.product-row').forEach(row => {
      const open = () => openModal(parseInt(row.dataset.index, 10));
      row.addEventListener('click', open);
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });
  }

  async function loadProducts() {
    productList.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
    try {
      const data = await api('/api/admin/products');
      products = data.products || [];
      renderProducts();
    } catch (err) {
      productList.innerHTML = '';
      notify(err.message, 'error');
    }
  }

  /* ---------------- modal ---------------- */

  const splitList = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

  function syncThumb() {
    const url = $('fImage').value.trim();
    const thumb = $('fThumb');
    thumb.src = url;
    thumb.classList.toggle('empty', !url);
  }

  function openModal(index) {
    editingIndex = typeof index === 'number' ? index : -1;
    const p = editingIndex >= 0 ? products[editingIndex] : { active: true };

    modalTitle.textContent = editingIndex >= 0 ? 'Edit Product' : 'Add Product';
    modalDelete.style.display = editingIndex >= 0 ? 'inline-block' : 'none';
    modalMsg.innerHTML = '';

    $('fName').value = p.name || '';
    $('fPrice').value = p.price != null && p.price !== '' ? p.price : '';
    $('fCategory').value = p.category || '';
    $('fSizes').value = (p.sizes || []).join(', ');
    $('fColors').value = (p.colors || []).join(', ');
    $('fDescription').value = p.description || '';
    $('fImage').value = p.image || '';
    $('fActive').checked = p.active !== false;
    syncThumb();

    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('fName').focus(), 50);
  }

  function closeModal() {
    modal.hidden = true;
    document.body.style.overflow = '';
    editingIndex = -1;
  }

  $('modalClose').addEventListener('click', closeModal);
  $('modalCancel').addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });
  $('addProductBtn').addEventListener('click', () => openModal());
  $('fImage').addEventListener('change', syncThumb);

  /* save the whole catalog back — the API replaces the sheet contents */
  async function persist(list, successMsg) {
    const saveBtn = $('modalSave');
    saveBtn.disabled = true;
    modalDelete.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await api('/api/admin/products', {
        method: 'PUT',
        body: JSON.stringify({ products: list }),
      });
      closeModal();
      await loadProducts();
      notify(successMsg);
    } catch (err) {
      modalMsg.innerHTML = `<div class="store-msg error">${esc(err.message)}</div>`;
    } finally {
      saveBtn.disabled = false;
      modalDelete.disabled = false;
      saveBtn.textContent = 'Save Product';
    }
  }

  // Enter inside the form should save, not reload the page.
  $('productForm').addEventListener('submit', e => {
    e.preventDefault();
    $('modalSave').click();
  });

  $('modalSave').addEventListener('click', () => {
    const name = $('fName').value.trim();
    const price = parseFloat($('fPrice').value);

    if (!name) {
      modalMsg.innerHTML = '<div class="store-msg error">Product name is required.</div>';
      return $('fName').focus();
    }
    if (!isFinite(price) || price < 0) {
      modalMsg.innerHTML = '<div class="store-msg error">Enter a valid price.</div>';
      return $('fPrice').focus();
    }

    const existing = editingIndex >= 0 ? products[editingIndex] : null;
    const product = {
      // Reuse the id when editing so existing orders keep pointing at this item.
      id: (existing && existing.id) || `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      price,
      category: $('fCategory').value.trim(),
      sizes: splitList($('fSizes').value),
      colors: splitList($('fColors').value),
      description: $('fDescription').value.trim(),
      image: $('fImage').value.trim(),
      active: $('fActive').checked,
    };

    const next = products.slice();
    if (editingIndex >= 0) next[editingIndex] = product;
    else next.push(product);

    persist(next, editingIndex >= 0 ? 'Product updated.' : 'Product added.');
  });

  modalDelete.addEventListener('click', () => {
    if (editingIndex < 0) return;
    const p = products[editingIndex];
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    const next = products.slice();
    next.splice(editingIndex, 1);
    persist(next, 'Product deleted.');
  });

  /* ---------------- image upload ---------------- */

  $('fPick').addEventListener('click', () => $('fFile').click());

  $('fFile').addEventListener('change', async () => {
    const file = $('fFile').files && $('fFile').files[0];
    if (!file) return;

    const btn = $('fPick');
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    try {
      const res = await fetch(`${API}/api/admin/upload`, {
        method: 'POST',
        headers: { 'Content-Type': file.type, Authorization: `Bearer ${token}` },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      $('fImage').value = data.url;
      syncThumb();
      modalMsg.innerHTML = '';
    } catch (err) {
      modalMsg.innerHTML = `<div class="store-msg error">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Upload Photo';
      $('fFile').value = '';
    }
  });

  /* ---------------- orders ---------------- */

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
          <td data-label="Order #">${esc(o.orderId)}</td>
          <td data-label="Date">${esc((o.timestamp || '').slice(0, 10))}</td>
          <td data-label="Parent">${esc(o.parentName)}</td>
          <td data-label="Email">${esc(o.email)}</td>
          <td data-label="Phone">${esc(o.phone)}</td>
          <td data-label="Player">${esc(o.playerName)}</td>
          <td data-label="Item">${esc(o.item)}</td>
          <td data-label="Size">${esc(o.size)}</td>
          <td data-label="Color">${esc(o.color)}</td>
          <td data-label="Qty">${esc(o.qty)}</td>
          <td data-label="Total">$${esc(o.lineTotal)}</td>
          <td data-label="Notes">${esc(o.notes)}</td>
        </tr>`).join('');
    } catch (err) {
      orderRows.innerHTML = '';
      notify(err.message, 'error');
    }
  }

  $('refreshOrdersBtn').addEventListener('click', loadOrders);

  $('exportBtn').addEventListener('click', () => {
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

  /* ---------------- boot ---------------- */

  if (token) showAdmin();
})();
