import type { LoaderFunctionArgs } from "react-router";

// Serves the cart-smart.js storefront injection script
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop") || "";

  const script = generateCartScript(shopParam);

  return new Response(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
};

function generateCartScript(shopHint: string): string {
  return `
(function() {
  'use strict';

  // ─── CartSmart: Plug & Play Custom Cart Drawer ───────────────────────────
  // Version 1.0 — injected via Shopify ScriptTag

  const CS = window.CartSmart = window.CartSmart || {};
  CS.shop = window.Shopify?.shop || '${shopHint}';
  CS.settings = window.cartSmartSettings || null;
  CS.rules   = window.cartUpsellShopRules || null;
  CS.drawerOpen = false;
  CS._cartCache = null;

  // ── 1. Fetch settings & rules on first load ──────────────────────────────
  async function initSettings() {
    if (!CS.settings) {
      try {
        const res = await fetch('/apps/upsell/settings?shop=' + encodeURIComponent(CS.shop));
        if (res.ok) {
          const data = await res.json();
          CS.settings = data.settings;
        }
      } catch(e) {}
    }
    if (!CS.settings) {
      CS.settings = getDefaultSettings();
    }
    applyGlobalCSS(CS.settings);
  }

  function getDefaultSettings() {
    return {
      headerTitle: 'Your Cart', headerBg: '#ffffff', headerTextColor: '#1a1a1a',
      bodyBg: '#ffffff', bodyTextColor: '#1a1a1a',
      borderColor: '#e5e7eb', borderRadius: 12, overlayBg: 'rgba(0,0,0,0.5)',
      qtyBtnBg: '#f3f4f6', qtyBtnText: '#1a1a1a',
      btnBg: '#1a1a1a', btnText: '#ffffff', btnRadius: 6, checkoutBtnText: 'Checkout',
      upsellEnabled: true, upsellTitle: 'You might also like',
      upsellBg: '#f9fafb', upsellBtnBg: '#1a1a1a', upsellBtnText: '#ffffff', upsellBtnRadius: 4,
      freeShippingEnabled: false, freeShippingThreshold: 5000,
      freeShippingText: 'Free shipping on orders over $50!',
      freeShippingBarBg: '#e5e7eb', freeShippingBarFill: '#22c55e',
      fontFamily: 'inherit', fontSize: 14,
    };
  }

  // ── 2. Inject base CSS ───────────────────────────────────────────────────
  function applyGlobalCSS(s) {
    const existing = document.getElementById('cart-smart-styles');
    if (existing) existing.remove();

    const style = document.createElement('style');
    style.id = 'cart-smart-styles';
    style.textContent = \`
      #cs-overlay {
        position: fixed; inset: 0; z-index: 100000;
        background: \${s.overlayBg};
        opacity: 0; pointer-events: none;
        transition: opacity 0.3s ease;
      }
      #cs-overlay.cs-open { opacity: 1; pointer-events: all; }

      #cs-drawer {
        position: fixed; top: 0; right: 0; bottom: 0;
        width: 420px; max-width: 100vw;
        z-index: 100001;
        background: \${s.bodyBg};
        color: \${s.bodyTextColor};
        font-family: \${s.fontFamily};
        font-size: \${s.fontSize}px;
        border-radius: \${s.borderRadius}px 0 0 \${s.borderRadius}px;
        box-shadow: -8px 0 32px rgba(0,0,0,0.18);
        display: flex; flex-direction: column;
        transform: translateX(110%);
        transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        overflow: hidden;
      }
      #cs-drawer.cs-open { transform: translateX(0); }

      /* Header */
      #cs-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 18px 20px;
        background: \${s.headerBg};
        color: \${s.headerTextColor};
        border-bottom: 1px solid \${s.borderColor};
        flex-shrink: 0;
      }
      #cs-header h2 {
        margin: 0; font-size: 17px; font-weight: 700; letter-spacing: -0.3px;
        display: flex; align-items: center; gap: 8px;
      }
      #cs-item-count {
        display: inline-flex; align-items: center; justify-content: center;
        background: \${s.btnBg}; color: \${s.btnText};
        border-radius: 99px; min-width: 22px; height: 22px;
        font-size: 12px; font-weight: 700; padding: 0 6px;
      }
      #cs-close-btn {
        background: none; border: none; cursor: pointer;
        color: \${s.headerTextColor}; font-size: 22px; line-height: 1;
        padding: 4px; border-radius: 4px; opacity: 0.7;
        transition: opacity 0.2s;
      }
      #cs-close-btn:hover { opacity: 1; }

      /* Free Shipping Bar */
      #cs-shipping-bar {
        padding: 12px 20px;
        background: \${s.bodyBg};
        border-bottom: 1px solid \${s.borderColor};
        flex-shrink: 0;
      }
      #cs-shipping-bar p { margin: 0 0 8px; font-size: 13px; text-align: center; }
      #cs-shipping-track {
        height: 6px; border-radius: 99px; background: \${s.freeShippingBarBg};
        overflow: hidden;
      }
      #cs-shipping-fill {
        height: 100%; border-radius: 99px;
        background: \${s.freeShippingBarFill};
        transition: width 0.5s ease;
      }

      /* Body / items scroll */
      #cs-body {
        flex: 1; overflow-y: auto; padding: 0;
      }
      #cs-body::-webkit-scrollbar { width: 4px; }
      #cs-body::-webkit-scrollbar-thumb { background: \${s.borderColor}; border-radius: 4px; }

      /* Empty state */
      #cs-empty {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 60px 20px; text-align: center; gap: 12px;
        color: \${s.bodyTextColor}; opacity: 0.6;
      }
      #cs-empty svg { width: 56px; height: 56px; opacity: 0.35; }
      #cs-empty p { margin: 0; font-size: 15px; font-weight: 500; }

      /* Cart items */
      #cs-items { list-style: none; margin: 0; padding: 0; }
      .cs-item {
        display: flex; align-items: flex-start; gap: 14px;
        padding: 16px 20px;
        border-bottom: 1px solid \${s.borderColor};
        animation: cs-fadein 0.2s ease;
      }
      @keyframes cs-fadein { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
      .cs-item-img {
        width: 72px; height: 72px; border-radius: 8px;
        object-fit: cover; border: 1px solid \${s.borderColor}; flex-shrink: 0;
        background: #f3f4f6;
      }
      .cs-item-info { flex: 1; min-width: 0; }
      .cs-item-title {
        font-size: 14px; font-weight: 600; color: \${s.bodyTextColor};
        margin: 0 0 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .cs-item-variant { font-size: 12px; opacity: 0.6; margin: 0 0 8px; }
      .cs-item-price { font-size: 14px; font-weight: 700; color: \${s.bodyTextColor}; }
      .cs-item-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
      .cs-qty-wrap {
        display: inline-flex; align-items: center;
        border: 1px solid \${s.borderColor}; border-radius: 6px; overflow: hidden;
      }
      .cs-qty-btn {
        background: \${s.qtyBtnBg}; color: \${s.qtyBtnText};
        border: none; width: 32px; height: 32px;
        font-size: 17px; cursor: pointer; line-height: 1;
        transition: background 0.15s; display: flex; align-items: center; justify-content: center;
      }
      .cs-qty-btn:hover { filter: brightness(0.92); }
      .cs-qty-val {
        min-width: 32px; text-align: center; font-size: 14px; font-weight: 600;
        padding: 0 4px;
      }
      .cs-remove-btn {
        background: none; border: none; cursor: pointer; font-size: 12px;
        color: \${s.bodyTextColor}; opacity: 0.45; text-decoration: underline;
        transition: opacity 0.15s;
      }
      .cs-remove-btn:hover { opacity: 0.8; }

      /* Upsell section */
      #cs-upsell {
        flex-shrink: 0;
        background: \${s.upsellBg};
        border-top: 1px solid \${s.borderColor};
        padding: 14px 0 14px;
      }
      #cs-upsell-title {
        font-size: 12px; font-weight: 700; text-transform: uppercase;
        letter-spacing: 0.7px; color: \${s.bodyTextColor}; opacity: 0.7;
        padding: 0 20px; margin: 0 0 10px;
      }
      #cs-upsell-track {
        display: flex; gap: 10px;
        padding: 0 20px;
        overflow-x: auto; scroll-snap-type: x mandatory;
        -webkit-overflow-scrolling: touch;
      }
      #cs-upsell-track::-webkit-scrollbar { height: 3px; }
      #cs-upsell-track::-webkit-scrollbar-thumb { background: \${s.borderColor}; border-radius: 4px; }
      .cs-upsell-card {
        flex-shrink: 0; width: 130px; scroll-snap-align: start;
        background: \${s.bodyBg}; border: 1px solid \${s.borderColor};
        border-radius: 8px; overflow: hidden;
        display: flex; flex-direction: column;
        transition: box-shadow 0.2s;
      }
      .cs-upsell-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
      .cs-upsell-img {
        width: 100%; height: 100px; object-fit: cover;
        background: #f3f4f6;
      }
      .cs-upsell-info { padding: 8px; flex: 1; display: flex; flex-direction: column; gap: 4px; }
      .cs-upsell-name {
        font-size: 12px; font-weight: 600; color: \${s.bodyTextColor};
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .cs-upsell-price { font-size: 12px; font-weight: 700; color: \${s.bodyTextColor}; }
      .cs-upsell-btn {
        margin: 0 8px 8px;
        background: \${s.upsellBtnBg}; color: \${s.upsellBtnText};
        border: none; border-radius: \${s.upsellBtnRadius}px;
        font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
        padding: 7px 4px; cursor: pointer; text-align: center;
        transition: filter 0.15s, transform 0.1s;
      }
      .cs-upsell-btn:hover { filter: brightness(1.1); }
      .cs-upsell-btn:active { transform: scale(0.97); }
      .cs-upsell-btn:disabled { opacity: 0.6; cursor: not-allowed; }

      /* Footer */
      #cs-footer {
        flex-shrink: 0;
        padding: 16px 20px;
        border-top: 1px solid \${s.borderColor};
        background: \${s.bodyBg};
      }
      #cs-subtotal-row {
        display: flex; justify-content: space-between; align-items: center;
        margin-bottom: 12px;
      }
      #cs-subtotal-label { font-size: 14px; font-weight: 500; opacity: 0.7; }
      #cs-subtotal-price { font-size: 18px; font-weight: 800; }
      #cs-checkout-btn {
        display: block; width: 100%;
        background: \${s.btnBg}; color: \${s.btnText};
        border: none; border-radius: \${s.btnRadius}px;
        font-size: 16px; font-weight: 700; letter-spacing: 0.3px;
        padding: 14px 20px; cursor: pointer; text-align: center;
        text-decoration: none;
        transition: filter 0.2s, transform 0.1s;
      }
      #cs-checkout-btn:hover { filter: brightness(1.1); }
      #cs-checkout-btn:active { transform: scale(0.98); }
      #cs-continue-link {
        display: block; text-align: center; margin-top: 10px;
        font-size: 13px; color: \${s.bodyTextColor}; opacity: 0.55;
        text-decoration: underline; cursor: pointer; background: none; border: none; width: 100%;
      }
      #cs-continue-link:hover { opacity: 0.85; }

      /* Loading spinner */
      .cs-loading {
        display: flex; align-items: center; justify-content: center;
        padding: 40px; opacity: 0.5;
      }
      @keyframes cs-spin { to { transform: rotate(360deg); } }
      .cs-spinner {
        width: 28px; height: 28px; border: 3px solid \${s.borderColor};
        border-top-color: \${s.btnBg}; border-radius: 50%;
        animation: cs-spin 0.7s linear infinite;
      }

      /* Hide native Shopify cart drawer when CartSmart is active */
      .cartSmart-active cart-drawer,
      .cartSmart-active #cart-drawer-notification,
      .cartSmart-active shopify-section[id*="cart-drawer"] {
        display: none !important;
      }
    \`;
    document.head.appendChild(style);
  }

  // ── 3. Build DOM ─────────────────────────────────────────────────────────
  function buildDOM() {
    if (document.getElementById('cs-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'cs-overlay';
    overlay.addEventListener('click', closeDrawer);

    const drawer = document.createElement('div');
    drawer.id = 'cs-drawer';
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-label', CS.settings.headerTitle);
    drawer.innerHTML = \`
      <div id="cs-header">
        <h2>
          \${escHtml(CS.settings.headerTitle)}
          <span id="cs-item-count">0</span>
        </h2>
        <button id="cs-close-btn" aria-label="Close cart">&#x2715;</button>
      </div>
      <div id="cs-shipping-bar" style="display:none"></div>
      <div id="cs-body">
        <div class="cs-loading"><div class="cs-spinner"></div></div>
      </div>
      <div id="cs-upsell" style="display:none">
        <p id="cs-upsell-title">\${escHtml(CS.settings.upsellTitle)}</p>
        <div id="cs-upsell-track"></div>
      </div>
      <div id="cs-footer" style="display:none">
        <div id="cs-subtotal-row">
          <span id="cs-subtotal-label">Subtotal</span>
          <span id="cs-subtotal-price"></span>
        </div>
        <a id="cs-checkout-btn" href="/checkout">\${escHtml(CS.settings.checkoutBtnText)} &rarr;</a>
        <button id="cs-continue-link">Continue shopping</button>
      </div>
    \`;

    document.body.appendChild(overlay);
    document.body.appendChild(drawer);

    drawer.querySelector('#cs-close-btn').addEventListener('click', closeDrawer);
    drawer.querySelector('#cs-continue-link').addEventListener('click', closeDrawer);
  }

  // ── 4. Open / Close ──────────────────────────────────────────────────────
  function openDrawer() {
    CS.drawerOpen = true;
    document.documentElement.style.overflow = 'hidden';
    document.getElementById('cs-overlay').classList.add('cs-open');
    document.getElementById('cs-drawer').classList.add('cs-open');
    loadCart();
  }

  function closeDrawer() {
    CS.drawerOpen = false;
    document.documentElement.style.overflow = '';
    document.getElementById('cs-overlay')?.classList.remove('cs-open');
    document.getElementById('cs-drawer')?.classList.remove('cs-open');
  }

  // ── 5. Load & Render Cart ────────────────────────────────────────────────
  async function loadCart(silent = false) {
    try {
      const res = await fetch('/cart.js');
      const cart = await res.json();
      CS._cartCache = cart;
      renderCart(cart, silent);
      if (CS.settings.upsellEnabled) loadUpsells(cart, silent);
    } catch(e) {
      console.error('[CartSmart] Cart fetch error:', e);
    }
  }

  function formatMoney(cents) {
    const amount = (cents / 100).toFixed(2);
    const currency = window.Shopify?.currency?.active || 'USD';
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency }).format(cents / 100);
    } catch {
      return '$' + amount;
    }
  }

  function renderCart(cart, silent) {
    const body = document.getElementById('cs-body');
    const footer = document.getElementById('cs-footer');
    const countEl = document.getElementById('cs-item-count');
    if (!body || !footer) return;

    const totalQty = cart.items.reduce((s, i) => s + i.quantity, 0);
    if (countEl) countEl.textContent = totalQty;

    if (!cart.items || cart.items.length === 0) {
      body.innerHTML = \`
        <div id="cs-empty">
          <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10 16h44l-5 28H15L10 16Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>
            <circle cx="24" cy="52" r="3" fill="currentColor"/>
            <circle cx="40" cy="52" r="3" fill="currentColor"/>
            <path d="M10 16l-3-10H3" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
          </svg>
          <p>Your cart is empty</p>
        </div>
      \`;
      footer.style.display = 'none';
      updateShippingBar(0);
      return;
    }

    const itemsHtml = cart.items.map((item, i) => \`
      <li class="cs-item" data-key="\${item.key}" data-index="\${i + 1}">
        <img class="cs-item-img"
          src="\${item.image || ''}"
          alt="\${escHtml(item.product_title)}"
          loading="lazy"
          onerror="this.style.visibility='hidden'"
        >
        <div class="cs-item-info">
          <p class="cs-item-title">\${escHtml(item.product_title)}</p>
          \${item.variant_title && item.variant_title !== 'Default Title'
            ? \`<p class="cs-item-variant">\${escHtml(item.variant_title)}</p>\`
            : ''}
          <p class="cs-item-price">\${formatMoney(item.line_price)}</p>
          <div class="cs-item-footer">
            <div class="cs-qty-wrap">
              <button class="cs-qty-btn" data-action="dec" data-key="\${item.key}">&#8722;</button>
              <span class="cs-qty-val">\${item.quantity}</span>
              <button class="cs-qty-btn" data-action="inc" data-key="\${item.key}">&#43;</button>
            </div>
            <button class="cs-remove-btn" data-key="\${item.key}">Remove</button>
          </div>
        </div>
      </li>
    \`).join('');

    body.innerHTML = \`<ul id="cs-items">\${itemsHtml}</ul>\`;

    // Subtotal
    document.getElementById('cs-subtotal-price').textContent = formatMoney(cart.total_price);
    footer.style.display = 'block';

    // Shipping bar
    updateShippingBar(cart.total_price);
  }

  function updateShippingBar(totalCents) {
    const bar = document.getElementById('cs-shipping-bar');
    if (!bar || !CS.settings.freeShippingEnabled) { if(bar) bar.style.display='none'; return; }
    const threshold = CS.settings.freeShippingThreshold;
    const pct = Math.min(100, Math.round((totalCents / threshold) * 100));
    const remaining = formatMoney(Math.max(0, threshold - totalCents));
    bar.style.display = 'block';
    if (totalCents >= threshold) {
      bar.innerHTML = \`<p>✅ You qualify for free shipping!</p><div id="cs-shipping-track"><div id="cs-shipping-fill" style="width:100%"></div></div>\`;
    } else {
      bar.innerHTML = \`<p>Spend \${remaining} more for \${escHtml(CS.settings.freeShippingText)}</p><div id="cs-shipping-track"><div id="cs-shipping-fill" style="width:\${pct}%"></div></div>\`;
    }
  }

  // ── 6. Upsell loading ────────────────────────────────────────────────────
  async function loadUpsells(cart, silent) {
    const upsellSection = document.getElementById('cs-upsell');
    const track = document.getElementById('cs-upsell-track');
    if (!upsellSection || !track || !cart.items?.length) {
      if (upsellSection) upsellSection.style.display = 'none';
      return;
    }

    const cartProductIdsNum = cart.items.map(i => i.product_id.toString());
    const cartProductGids = cartProductIdsNum.map(id => 'gid://shopify/Product/' + id);
    const allCartIds = [...cartProductIdsNum, ...cartProductGids];

    let upsellProducts = [];

    // Try rules from metafield first (0ms)
    if (CS.rules && Array.isArray(CS.rules) && CS.rules.length > 0) {
      const active = CS.rules.filter(r => r.enabled !== false).sort((a,b) => (b.priority||0)-(a.priority||0));
      let matched = active.find(r => r.ruleType === 'PRODUCT' && r.targetId && allCartIds.includes(r.targetId.toString()));
      if (!matched) matched = active.find(r => r.ruleType === 'GLOBAL');
      if (matched?.products?.length) {
        const max = matched.maxProducts || 3;
        upsellProducts = matched.products
          .filter(p => {
            const numId = (p.productId||'').toString().replace('gid://shopify/Product/','');
            return !cartProductIdsNum.includes(numId);
          })
          .slice(0, max);
      }
    }

    // API fallback
    if (!upsellProducts.length) {
      try {
        const idsStr = cartProductIdsNum.join(',');
        const r = await fetch('/apps/upsell/api?shop=' + encodeURIComponent(CS.shop) + '&product_ids=' + encodeURIComponent(idsStr));
        if (r.ok) {
          const data = await r.json();
          if (data.products?.length) upsellProducts = data.products;
        }
      } catch(e) {}
    }

    if (!upsellProducts.length) {
      upsellSection.style.display = 'none';
      return;
    }

    const cards = upsellProducts.map(p => {
      const rawVid = p.variantId || '';
      const vid = (p.numericVariantId || rawVid.toString().replace('gid://shopify/ProductVariant/','')).toString();
      const title = p.productTitle || p.title || 'Recommended';
      const img = p.productImage || p.image || '';
      const price = p.price ? formatMoney(Math.round(parseFloat(p.price)*100)) : '';
      return \`
        <div class="cs-upsell-card">
          \${img ? \`<img class="cs-upsell-img" src="\${escHtml(img)}" alt="\${escHtml(title)}" loading="lazy">\` : '<div class="cs-upsell-img"></div>'}
          <div class="cs-upsell-info">
            <span class="cs-upsell-name">\${escHtml(title)}</span>
            \${price ? \`<span class="cs-upsell-price">\${price}</span>\` : ''}
          </div>
          <button class="cs-upsell-btn" data-cs-upsell-vid="\${vid}">+ ADD</button>
        </div>
      \`;
    }).join('');

    track.innerHTML = cards;
    upsellSection.style.display = 'block';
  }

  // ── 7. Cart mutations (qty change / remove / upsell ATC) ─────────────────
  async function updateQty(key, delta, absQty) {
    try {
      const currentItems = CS._cartCache?.items || [];
      const item = currentItems.find(i => i.key === key);
      const currentQty = item ? item.quantity : 1;
      const newQty = absQty !== undefined ? absQty : currentQty + delta;

      const res = await fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: key, quantity: Math.max(0, newQty) }),
      });
      const cart = await res.json();
      CS._cartCache = cart;
      renderCart(cart, true);
      if (CS.settings.upsellEnabled) loadUpsells(cart, true);
      updateCartBubble(cart.item_count);
    } catch(e) {
      console.error('[CartSmart] Qty update error:', e);
    }
  }

  async function addUpsellToCart(variantId, btn) {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '...';
    try {
      const res = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ items: [{ id: Number(variantId), quantity: 1 }] }),
      });
      if (!res.ok) throw new Error('Add failed');
      btn.textContent = '✓ Added';
      // Refresh cart items + totals in-place without hiding upsell section
      await refreshCartInPlace();
    } catch(e) {
      btn.disabled = false;
      btn.textContent = '+ ADD';
    }
  }

  async function refreshCartInPlace() {
    try {
      const res = await fetch('/cart.js');
      const cart = await res.json();
      CS._cartCache = cart;
      renderCart(cart, true);
      updateCartBubble(cart.item_count);
      // Reload upsells silently to remove newly-added product from recommendations
      if (CS.settings.upsellEnabled) loadUpsells(cart, true);
    } catch(e) {}
  }

  function updateCartBubble(count) {
    document.querySelectorAll('[id*="cart-icon-bubble"] .cart-count-bubble span, .cart-count-bubble span').forEach(el => {
      el.textContent = count;
    });
    document.querySelectorAll('[aria-label*="cart"] .count, [data-cart-count]').forEach(el => {
      el.textContent = count;
    });
  }

  // ── 8. Event delegation for cart interactions ────────────────────────────
  function bindEvents() {
    document.addEventListener('click', function(e) {
      // Qty buttons
      const qtyBtn = e.target.closest('.cs-qty-btn');
      if (qtyBtn) {
        const key = qtyBtn.dataset.key;
        const action = qtyBtn.dataset.action;
        updateQty(key, action === 'inc' ? 1 : -1);
        return;
      }
      // Remove
      const removeBtn = e.target.closest('.cs-remove-btn');
      if (removeBtn) {
        updateQty(removeBtn.dataset.key, 0, 0);
        return;
      }
      // Upsell ATC
      const upsellBtn = e.target.closest('[data-cs-upsell-vid]');
      if (upsellBtn) {
        addUpsellToCart(upsellBtn.dataset.csUpsellVid, upsellBtn);
        return;
      }
    });
  }

  // ── 9. Intercept native cart open triggers ───────────────────────────────
  function interceptCartOpeners() {
    // Intercept any link/button that goes to /cart
    document.addEventListener('click', function(e) {
      const el = e.target.closest('a[href="/cart"], a[href*="/cart"]:not([href*="checkout"]), [data-cart-toggle], [data-drawer-trigger]');
      if (!el) return;
      const href = el.getAttribute('href') || '';
      if (href && !href.includes('/cart') && !el.hasAttribute('data-cart-toggle') && !el.hasAttribute('data-drawer-trigger')) return;
      // Don't intercept checkout links
      if (href.includes('checkout')) return;
      e.preventDefault();
      e.stopPropagation();
      openDrawer();
    }, true);

    // Intercept Shopify custom events
    document.addEventListener('cart:open', function(e) {
      e.preventDefault?.();
      e.stopPropagation?.();
      openDrawer();
    }, true);

    // Intercept ATC forms - open cart after adding
    document.addEventListener('submit', async function(e) {
      const form = e.target.closest('form[action*="/cart/add"]');
      if (!form) return;
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Accept': 'application/json' },
          body: fd,
        });
        openDrawer();
      } catch(err) {
        // fallback to native submit
        form.submit();
      }
    });

    // Intercept native Shopify cart drawer open attempts
    const observer = new MutationObserver(() => {
      const nativeDrawer = document.querySelector('cart-drawer');
      if (nativeDrawer) {
        nativeDrawer.addEventListener('click', (e) => {
          e.stopPropagation();
        }, { capture: true });
      }
    });
    observer.observe(document.body, { childList: true, subtree: false });
  }

  // ── 10. Utility ──────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  // ── 11. Boot ─────────────────────────────────────────────────────────────
  async function boot() {
    await initSettings();
    document.body.classList.add('cartSmart-active');
    buildDOM();
    bindEvents();
    interceptCartOpeners();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Expose public API for manual triggering
  CS.open = openDrawer;
  CS.close = closeDrawer;
  CS.refresh = refreshCartInPlace;
})();
`;
}
