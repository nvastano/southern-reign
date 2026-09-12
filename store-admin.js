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
      if (p.customLabel) bits.push(`✎ ${p.customLabel}`);

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
    $('fCustomLabel').value = p.customLabel || '';
    $('fCustomRequired').checked = !!p.customRequired;
    $('fActive').checked = p.active !== false;
    syncCustomRequired();
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
    if (e.key !== 'Escape') return;
    if (!modal.hidden) closeModal();
    if (!$('orderModal').hidden) closeOrderModal();
    if (!$('exportModal').hidden) closeExport();
  });
  $('addProductBtn').addEventListener('click', () => openModal());
  $('fImage').addEventListener('change', syncThumb);

  function syncCustomRequired() {
    const on = !!$('fCustomLabel').value.trim();
    $('fCustomRequiredWrap').style.display = on ? 'flex' : 'none';
    if (!on) $('fCustomRequired').checked = false;
  }
  $('fCustomLabel').addEventListener('input', syncCustomRequired);

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
      customLabel: $('fCustomLabel').value.trim(),
      customRequired: $('fCustomLabel').value.trim() ? $('fCustomRequired').checked : false,
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

  const orderList = $('orderList');
  let expanded = new Set();
  let selected = new Set();   // order ids ticked for a bulk change

  const STATUSES = ['NEW', 'CONFIRMED', 'PAID', 'ORDERED', 'DELIVERED', 'CANCELLED'];
  const STATUS_LABEL = {
    NEW: 'New', CONFIRMED: 'Confirmed', PAID: 'Paid',
    ORDERED: 'Ordered', DELIVERED: 'Delivered', CANCELLED: 'Cancelled',
  };
  // An order's status is the one its lines agree on; 'MIXED' when they don't.
  const groupStatus = g => (g.statuses.size === 1 ? Array.from(g.statuses)[0] : 'MIXED');

  /* group the flat line rows into one card per order */
  function groupOrders(list) {
    const map = new Map();
    for (const o of list) {
      if (!map.has(o.orderId)) {
        map.set(o.orderId, {
          orderId: o.orderId, timestamp: o.timestamp, parentName: o.parentName,
          email: o.email, phone: o.phone, playerName: o.playerName,
          notes: o.notes, lines: [], total: 0, items: 0, statuses: new Set(),
        });
      }
      const g = map.get(o.orderId);
      g.lines.push(o);
      g.total += parseFloat(o.lineTotal) || 0;
      g.items += parseInt(o.qty, 10) || 0;
      g.statuses.add(o.status || 'NEW');
    }
    return Array.from(map.values()).reverse(); // newest first
  }

  function matchesFilters(g) {
    const q = $('orderSearch').value.trim().toLowerCase();
    const status = $('orderStatusFilter').value;

    if (status && !g.statuses.has(status)) return false;
    if (!q) return true;

    const hay = [g.orderId, g.parentName, g.email, g.phone, g.playerName, g.notes]
      .concat(g.lines.map(l => `${l.item} ${l.size} ${l.color} ${l.custom}`))
      .join(' ').toLowerCase();
    return hay.includes(q);
  }

  function renderOrders() {
    const groups = groupOrders(orders).filter(matchesFilters);

    const allGroups = groupOrders(orders);
    const revenue = allGroups.reduce((s, g) => s + g.total, 0);
    const units = allGroups.reduce((s, g) => s + g.items, 0);
    $('ordersStats').innerHTML = `
      <div class="stat"><span class="stat-num">${allGroups.length}</span><span class="stat-label">Orders</span></div>
      <div class="stat"><span class="stat-num">${units}</span><span class="stat-label">Items</span></div>
      <div class="stat"><span class="stat-num">${money(revenue)}</span><span class="stat-label">Total</span></div>`;

    if (!allGroups.length) {
      orderList.innerHTML = '<div class="empty-state"><p>No orders yet.</p></div>';
      return;
    }
    if (!groups.length) {
      orderList.innerHTML = '<div class="empty-state"><p>No orders match that search.</p></div>';
      return;
    }

    orderList.innerHTML = groups.map(g => {
      const open = expanded.has(g.orderId);
      const st = groupStatus(g);
      const statusSelect = `
        <select class="order-status st-${esc(st.toLowerCase())}" data-status-for="${esc(g.orderId)}"
                aria-label="Status for ${esc(g.orderId)}">
          ${st === 'MIXED' ? '<option value="" selected>Mixed</option>' : ''}
          ${STATUSES.map(v =>
            `<option value="${v}"${v === st ? ' selected' : ''}>${STATUS_LABEL[v]}</option>`).join('')}
        </select>`;

      const lines = g.lines.map(l => `
        <div class="oline">
          <div class="ol-main">
            <div class="ol-item">${esc(l.item)}</div>
            <div class="ol-meta">${esc([l.size, l.color].filter(Boolean).join(' · '))}</div>
            ${l.custom ? `<div class="ol-custom">${esc(l.custom)}</div>` : ''}
          </div>
          <div class="ol-qty">&times;${esc(l.qty)}</div>
          <div class="ol-total">$${esc(l.lineTotal)}</div>
          <button type="button" class="btn-sm secondary ol-edit" data-edit="${l.row}">Edit</button>
        </div>`).join('');

      const contact = [
        g.email ? `<a href="mailto:${esc(g.email)}">${esc(g.email)}</a>` : '',
        g.phone ? `<a href="tel:${esc(g.phone)}">${esc(g.phone)}</a>` : '',
        g.playerName ? `Player: ${esc(g.playerName)}` : '',
      ].filter(Boolean).join(' &nbsp;·&nbsp; ');

      return `
        <div class="order-card${open ? ' open' : ''}${selected.has(g.orderId) ? ' selected' : ''}" data-oid="${esc(g.orderId)}">
          <div class="order-head" role="button" tabindex="0">
            <input type="checkbox" class="order-pick" data-pick="${esc(g.orderId)}"
                   ${selected.has(g.orderId) ? 'checked' : ''} aria-label="Select ${esc(g.orderId)}" />
            <div class="oc-left">
              <div class="oc-name">${esc(g.parentName || '—')}</div>
              <div class="oc-meta">
                ${esc(g.orderId)} &nbsp;·&nbsp; ${esc((g.timestamp || '').slice(0, 10))}
                &nbsp;·&nbsp; ${g.items} item${g.items === 1 ? '' : 's'}
              </div>
            </div>
            <div class="oc-right">
              <div class="oc-total">${money(g.total)}</div>
              ${statusSelect}
              <span class="oc-caret">${open ? '&minus;' : '+'}</span>
            </div>
          </div>
          <div class="order-body"${open ? '' : ' hidden'}>
            ${lines}
            <div class="order-contact">${contact}</div>
            ${g.notes ? `<div class="order-notes"><strong>Notes:</strong> ${esc(g.notes)}</div>` : ''}
          </div>
        </div>`;
    }).join('');

    orderList.querySelectorAll('.order-head').forEach(head => {
      const card = head.closest('.order-card');
      const toggle = () => {
        const id = card.dataset.oid;
        if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
        renderOrders();
      };
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    });

    orderList.querySelectorAll('.ol-edit').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openOrderModal(parseInt(btn.dataset.edit, 10));
      });
    });

    // Changing the dropdown writes that status to every line of the order.
    orderList.querySelectorAll('[data-status-for]').forEach(sel => {
      sel.addEventListener('click', e => e.stopPropagation());
      sel.addEventListener('change', async e => {
        e.stopPropagation();
        const value = sel.value;
        if (!value) return;
        sel.disabled = true;
        await applyStatus([sel.dataset.statusFor], value);
      });
    });

    orderList.querySelectorAll('[data-pick]').forEach(box => {
      box.addEventListener('click', e => e.stopPropagation());
      box.addEventListener('change', () => {
        const id = box.dataset.pick;
        if (box.checked) selected.add(id); else selected.delete(id);
        renderOrders();
      });
    });

    syncBulkBar(groups);
  }

  /* ---------------- status changes ---------------- */

  function syncBulkBar(visibleGroups) {
    const n = selected.size;
    $('bulkBar').hidden = !visibleGroups.length;
    $('bulkCount').textContent = n
      ? `${n} order${n === 1 ? '' : 's'} selected`
      : 'Select all shown';
    $('bulkApply').disabled = !n || !$('bulkStatus').value;

    const allShown = visibleGroups.length > 0 &&
      visibleGroups.every(g => selected.has(g.orderId));
    $('selectAll').checked = allShown;
  }

  /** Write `status` to every line of each given order id. */
  async function applyStatus(orderIds, status) {
    const wanted = new Set(orderIds);
    const targets = orders
      .filter(o => wanted.has(o.orderId))
      .map(o => ({ row: o.row, orderId: o.orderId }));

    if (!targets.length) return;

    try {
      const res = await api('/api/admin/orders/status', {
        method: 'POST',
        body: JSON.stringify({ targets, status }),
      });
      await loadOrders();
      const label = STATUS_LABEL[status] || status;
      notify(
        `${orderIds.length} order${orderIds.length === 1 ? '' : 's'} marked ${label}.` +
        (res.skipped ? ` ${res.skipped} line(s) skipped — refresh and retry those.` : '')
      );
    } catch (err) {
      notify(err.message, 'error');
      await loadOrders();
    }
  }

  async function loadOrders() {
    orderList.innerHTML = '<div class="empty-state"><p>Loading…</p></div>';
    try {
      const data = await api('/api/admin/orders');
      orders = data.orders || [];
      renderOrders();
    } catch (err) {
      orderList.innerHTML = '';
      notify(err.message, 'error');
    }
  }

  $('orderSearch').addEventListener('input', renderOrders);
  $('orderStatusFilter').addEventListener('change', renderOrders);

  $('selectAll').addEventListener('change', () => {
    const shown = groupOrders(orders).filter(matchesFilters);
    if ($('selectAll').checked) shown.forEach(g => selected.add(g.orderId));
    else shown.forEach(g => selected.delete(g.orderId));
    renderOrders();
  });

  $('bulkStatus').addEventListener('change', () => {
    $('bulkApply').disabled = !selected.size || !$('bulkStatus').value;
  });

  $('bulkApply').addEventListener('click', async () => {
    const status = $('bulkStatus').value;
    const ids = Array.from(selected);
    if (!status || !ids.length) return;

    const btn = $('bulkApply');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    await applyStatus(ids, status);
    selected.clear();
    $('bulkStatus').value = '';
    btn.textContent = 'Apply';
    renderOrders();
  });

  /* ---------------- order editing ---------------- */

  const orderModal = $('orderModal');
  let editingOrder = null;

  function refreshLineTotal() {
    const product = products.find(p => p.name === $('oItem').value);
    const qty = Math.max(1, parseInt($('oQty').value, 10) || 1);
    const unit = product ? product.price : parseFloat(editingOrder.unitPrice) || 0;
    $('oTotalNote').textContent =
      `${qty} × ${money(unit)} = ${money(unit * qty)}`;
  }

  function openOrderModal(row) {
    const order = orders.find(o => o.row === row);
    if (!order) return;
    editingOrder = order;

    // Product list, plus the recorded item if it has since been renamed or removed.
    const names = products.map(p => p.name);
    if (order.item && !names.includes(order.item)) names.unshift(order.item);
    $('oItem').innerHTML = names
      .map(n => `<option${n === order.item ? ' selected' : ''}>${esc(n)}</option>`)
      .join('');

    $('oSummary').textContent =
      `${order.orderId} · submitted ${(order.timestamp || '').slice(0, 10)}`;
    $('oSize').value = order.size || '';
    $('oColor').value = order.color || '';
    $('oQty').value = order.qty || 1;
    $('oStatus').value = order.status || 'NEW';
    $('oParent').value = order.parentName || '';
    $('oEmail').value = order.email || '';
    $('oPhone').value = order.phone || '';
    $('oPlayer').value = order.playerName || '';
    $('oCustom').value = order.custom || '';
    $('oNotes').value = order.notes || '';
    $('oMsg').innerHTML = '';
    refreshLineTotal();

    orderModal.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function closeOrderModal() {
    orderModal.hidden = true;
    document.body.style.overflow = '';
    editingOrder = null;
  }

  $('oClose').addEventListener('click', closeOrderModal);
  $('oCancel').addEventListener('click', closeOrderModal);
  orderModal.addEventListener('click', e => { if (e.target === orderModal) closeOrderModal(); });
  $('oItem').addEventListener('change', refreshLineTotal);
  $('oQty').addEventListener('input', refreshLineTotal);
  $('orderForm').addEventListener('submit', e => { e.preventDefault(); $('oSave').click(); });

  $('oSave').addEventListener('click', async () => {
    if (!editingOrder) return;
    const btn = $('oSave');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      await api('/api/admin/orders', {
        method: 'PUT',
        body: JSON.stringify({
          row: editingOrder.row,
          orderId: editingOrder.orderId,
          item: $('oItem').value,
          size: $('oSize').value.trim(),
          color: $('oColor').value.trim(),
          qty: $('oQty').value,
          status: $('oStatus').value,
          parentName: $('oParent').value.trim(),
          email: $('oEmail').value.trim(),
          phone: $('oPhone').value.trim(),
          playerName: $('oPlayer').value.trim(),
          custom: $('oCustom').value.trim(),
          notes: $('oNotes').value.trim(),
        }),
      });
      closeOrderModal();
      await loadOrders();
      notify('Order updated in the Google Sheet.');
    } catch (err) {
      $('oMsg').innerHTML = `<div class="store-msg error">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Order';
    }
  });

  $('refreshOrdersBtn').addEventListener('click', loadOrders);

  /* ---------------- export ---------------- */

  const exportModal = $('exportModal');

  $('exportBtn').addEventListener('click', () => {
    // Count lines per status so you can see what you're about to export.
    const counts = {};
    orders.forEach(o => {
      const st = (o.status || 'NEW').toUpperCase();
      counts[st] = (counts[st] || 0) + 1;
    });

    const filtered = $('orderStatusFilter').value;
    $('exStatusList').innerHTML = STATUSES.map(st => {
      const n = counts[st] || 0;
      // Default to whatever the list is filtered to, else everything with lines.
      const on = filtered ? st === filtered : n > 0;
      return `
        <label class="ex-status${n ? '' : ' empty'}">
          <input type="checkbox" value="${st}" ${on && n ? 'checked' : ''} ${n ? '' : 'disabled'} />
          <span class="ex-name">${STATUS_LABEL[st]}</span>
          <span class="ex-count">${n} line${n === 1 ? '' : 's'}</span>
        </label>`;
    }).join('');

    $('exMsg').innerHTML = '';
    exportModal.hidden = false;
    document.body.style.overflow = 'hidden';
  });

  function closeExport() {
    exportModal.hidden = true;
    document.body.style.overflow = '';
  }
  $('exClose').addEventListener('click', closeExport);
  $('exCancel').addEventListener('click', closeExport);
  exportModal.addEventListener('click', e => { if (e.target === exportModal) closeExport(); });

  const csvCell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

  $('exDownload').addEventListener('click', () => {
    const chosen = new Set(
      Array.from($('exStatusList').querySelectorAll('input:checked')).map(i => i.value)
    );
    if (!chosen.size) {
      $('exMsg').innerHTML = '<div class="store-msg error">Pick at least one status.</div>';
      return;
    }

    const rows = orders.filter(o => chosen.has((o.status || 'NEW').toUpperCase()));
    if (!rows.length) {
      $('exMsg').innerHTML = '<div class="store-msg error">No orders with those statuses.</div>';
      return;
    }

    const cols = ['orderId', 'timestamp', 'parentName', 'email', 'phone', 'playerName',
      'item', 'size', 'color', 'custom', 'qty', 'unitPrice', 'lineTotal', 'notes', 'status'];
    const lines = [cols.join(',')]
      .concat(rows.map(o => cols.map(c => csvCell(o[c])).join(',')));

    // Optional roll-up so the producer can see totals per item/size/colour.
    if ($('exGroupRows').checked) {
      const totals = new Map();
      rows.forEach(o => {
        const key = [o.item, o.size, o.color, o.custom].join(' | ');
        totals.set(key, (totals.get(key) || 0) + (parseInt(o.qty, 10) || 0));
      });
      lines.push('');
      lines.push(['SUMMARY', 'item', 'size', 'color', 'custom', 'qty'].join(','));
      Array.from(totals.entries()).sort().forEach(([key, qty]) => {
        const [item, size, color, custom] = key.split(' | ');
        lines.push(['', item, size, color, custom, qty].map(csvCell).join(','));
      });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const tag = chosen.size === STATUSES.length ? 'all' :
      Array.from(chosen).map(s => s.toLowerCase()).join('-');

    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `southern-reign-orders-${tag}-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    closeExport();
    notify(`Exported ${rows.length} line${rows.length === 1 ? '' : 's'}.`);
  });

  /* ---------------- boot ---------------- */

  if (token) showAdmin();
})();
