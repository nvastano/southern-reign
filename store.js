(function () {
  const API = window.STORE_API;

  const grid = document.getElementById('productGrid');
  const statusEl = document.getElementById('storeStatus');
  const layout = document.getElementById('storeLayout');
  const cartItemsEl = document.getElementById('cartItems');
  const cartTotalEl = document.getElementById('cartTotal');
  const cartTotalAmount = document.getElementById('cartTotalAmount');
  const checkoutForm = document.getElementById('checkoutForm');
  const checkoutMsg = document.getElementById('checkoutMsg');
  const submitBtn = document.getElementById('submitBtn');

  let products = [];
  let cart = [];

  const money = n => '$' + Number(n).toFixed(2);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- render products ---------- */

  function renderProducts() {
    if (!products.length) {
      statusEl.textContent = 'The team store is being set up — check back soon!';
      return;
    }

    grid.innerHTML = products.map(p => {
      const sizeSelect = p.sizes.length
        ? `<select data-role="size">${p.sizes.map(s => `<option>${esc(s)}</option>`).join('')}</select>`
        : '';
      const colorSelect = p.colors.length
        ? `<select data-role="color">${p.colors.map(c => `<option>${esc(c)}</option>`).join('')}</select>`
        : '';
      const img = p.image
        ? `<img class="product-img" src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" />`
        : `<div class="product-img-placeholder">&#9918;</div>`;

      const customField = p.customLabel ? `
        <div class="product-custom">
          <label>${esc(p.customLabel)}${p.customRequired ? ' <em>required</em>' : ' <em>optional</em>'}</label>
          <input type="text" data-role="custom" maxlength="60"
                 placeholder="${esc(p.customLabel)}" />
        </div>` : '';

      return `
        <div class="product-card" data-id="${esc(p.id)}">
          ${img}
          <div class="product-body">
            <div class="product-name">${esc(p.name)}</div>
            <div class="product-price">${money(p.price)}</div>
            ${p.description ? `<div class="product-desc">${esc(p.description)}</div>` : ''}
            ${customField}
            <div class="product-opts">
              ${sizeSelect}
              ${colorSelect}
              <input type="number" data-role="qty" value="1" min="1" max="99" aria-label="Quantity" />
            </div>
            <div class="product-err" data-role="err"></div>
            <button class="btn-add" data-role="add">Add to Order</button>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('[data-role="add"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.product-card');
        const product = products.find(p => p.id === card.dataset.id);
        if (!product) return;

        const pick = role => {
          const el = card.querySelector(`[data-role="${role}"]`);
          return el ? el.value : '';
        };
        const qty = Math.max(1, Math.min(99, parseInt(pick('qty'), 10) || 1));
        const custom = pick('custom').trim();
        const errEl = card.querySelector('[data-role="err"]');

        if (product.customLabel && product.customRequired && !custom) {
          errEl.textContent = `${product.customLabel} is required.`;
          const input = card.querySelector('[data-role="custom"]');
          if (input) input.focus();
          return;
        }
        errEl.textContent = '';

        addToCart(product, pick('size'), pick('color'), qty, custom);
        const customInput = card.querySelector('[data-role="custom"]');
        if (customInput) customInput.value = '';

        btn.textContent = 'Added ✓';
        btn.classList.add('added');
        setTimeout(() => {
          btn.textContent = 'Add to Order';
          btn.classList.remove('added');
        }, 1200);
      });
    });

    statusEl.style.display = 'none';
    layout.style.display = 'grid';
  }

  /* ---------- cart ---------- */

  function addToCart(product, size, color, qty, custom) {
    // Same product, size, colour AND customization collapses into one line.
    // A different number on a hat has to stay its own line.
    const existing = cart.find(i =>
      i.productId === product.id && i.size === size &&
      i.color === color && i.custom === custom);
    if (existing) {
      existing.qty = Math.min(99, existing.qty + qty);
    } else {
      cart.push({
        productId: product.id, name: product.name,
        price: product.price, size, color, qty,
        custom, customLabel: product.customLabel || '',
      });
    }
    renderCart();
  }

  function renderCart() {
    if (!cart.length) {
      cartItemsEl.innerHTML = '<p class="cart-empty">Nothing added yet.</p>';
      cartTotalEl.style.display = 'none';
      checkoutForm.style.display = 'none';
      return;
    }

    cartItemsEl.innerHTML = cart.map((item, i) => {
      const meta = [item.size, item.color].filter(Boolean).join(' · ');
      const custom = item.custom
        ? `${item.customLabel ? item.customLabel + ': ' : ''}${item.custom}` : '';
      return `
        <div class="cart-item">
          <div>
            <div class="cart-item-name">${esc(item.name)}</div>
            ${meta ? `<div class="cart-item-meta">${esc(meta)}</div>` : ''}
            ${custom ? `<div class="cart-item-custom">${esc(custom)}</div>` : ''}
            <div class="cart-item-meta">Qty ${item.qty} &times; ${money(item.price)}</div>
          </div>
          <div class="cart-item-right">
            <div>${money(item.price * item.qty)}</div>
            <button class="cart-remove" data-index="${i}">Remove</button>
          </div>
        </div>`;
    }).join('');

    cartItemsEl.querySelectorAll('.cart-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        cart.splice(parseInt(btn.dataset.index, 10), 1);
        renderCart();
      });
    });

    const total = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
    cartTotalAmount.textContent = money(total);
    cartTotalEl.style.display = 'flex';
    checkoutForm.style.display = 'block';
  }

  /* ---------- checkout ---------- */

  checkoutForm.addEventListener('submit', async e => {
    e.preventDefault();
    checkoutMsg.innerHTML = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    try {
      const res = await fetch(`${API}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parentName: document.getElementById('parentName').value.trim(),
          email: document.getElementById('email').value.trim(),
          phone: document.getElementById('phone').value.trim(),
          playerName: document.getElementById('playerName').value.trim(),
          notes: document.getElementById('notes').value.trim(),
          items: cart.map(i => ({
            productId: i.productId, size: i.size, color: i.color,
            qty: i.qty, custom: i.custom,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Order failed');

      const pay = window.STORE_PAYMENT || {};

      cart = [];
      renderCart();
      checkoutForm.reset();
      statusEl.style.display = 'block';
      statusEl.innerHTML = `
        <div class="order-confirm">
          <div class="confirm-check">&#10003;</div>
          <h3>Order Received</h3>
          <p class="confirm-sub">
            Confirmation number <strong>${esc(data.orderId)}</strong>
            ${data.emailed ? '&bull; a confirmation email is on its way' : ''}
          </p>

          <div class="confirm-total">
            <span>Amount Due</span>
            <strong>${esc(money(data.total))}</strong>
          </div>

          <div class="pay-box">
            <div class="pay-head">Please send payment now</div>
            <p class="pay-line">
              ${esc(money(data.total))} to <strong>${esc(pay.name || '')}</strong>
              on ${esc(pay.app || '')}
            </p>
            <div class="pay-handle">${esc(pay.handle || '')}</div>
            ${pay.url ? `<a class="btn pay-btn" href="${esc(pay.url)}" target="_blank" rel="noopener">Open ${esc(pay.app || 'payment app')}</a>` : ''}
            <p class="pay-note">
              Please put your confirmation number <strong>${esc(data.orderId)}</strong>
              in the payment note so we can match it to your order.
            </p>
          </div>

          <p class="confirm-foot">
            Questions? Email
            <a href="mailto:SouthernReignBaseball@gmail.com">SouthernReignBaseball@gmail.com</a>
          </p>
        </div>`;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      checkoutMsg.innerHTML =
        `<div class="store-msg error">${esc(err.message)}</div>`;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Order';
    }
  });

  /* ---------- load ---------- */

  fetch(`${API}/api/products`)
    .then(r => r.json())
    .then(data => {
      products = data.products || [];
      renderProducts();
    })
    .catch(err => {
      console.error('Store load failed:', err);
      statusEl.textContent = 'The team store is temporarily unavailable. Please try again later.';
    });
})();
