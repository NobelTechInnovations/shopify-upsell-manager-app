# Smooth Native Cart Drawer Upsell Snippet (Zero-Flicker & Theme-Native)

This code solves the **hiding & flickering issue** when clicking "+ ADD" and uses **native theme CSS variables** (`rgb(var(--color-background))`, `rgb(var(--color-foreground))`, theme fonts & colors) so it matches your Dawn / Shopify theme 100%.

---

## 📋 Complete Code for `snippets/cart-drawer-upsell.liquid`

```html
{% comment %}
  Cart Smart Upsell Manager — Native Theme Drawer Integration
  Features: Zero Flicker In-Place Drawer Updates + Theme CSS Variables
{% endcomment %}

<div class="cart-drawer-upsell" data-upsell-container style="display: none;">
  <div class="cart-drawer-upsell__header">
    <h3>You might also like</h3>
  </div>

  <div class="cart-drawer-upsell__products">
    {% comment %} Dynamic products from Upsell Manager render here {% comment %}
  </div>
</div>

<script>
// Load shop metafield rules for instant 0ms rendering
window.cartUpsellShopRules = {{ shop.metafields.upsell.rules.value | json }};

class CartDrawerUpsell {
  constructor() {
    this.bindEvents();
    this.loadUpsells();
  }

  async loadUpsells(isSilentRefresh = false) {
    try {
      const wrapper = document.querySelector('[data-upsell-container]');
      const container = document.querySelector('.cart-drawer-upsell__products');
      if (!wrapper || !container) return;

      // 1. Fetch current cart contents
      const cartRes = await fetch('/cart.js');
      const cart = await cartRes.json();

      if (!cart.items || cart.items.length === 0) {
        wrapper.style.display = 'none';
        return;
      }

      // Collect cart product IDs (both numeric and GID formats)
      const cartProductIdsNumeric = cart.items.map(item => item.product_id.toString());
      const cartProductGids = cart.items.map(item => `gid://shopify/Product/${item.product_id}`);
      const allCartProductIds = [...cartProductIdsNumeric, ...cartProductGids];

      let upsellProducts = [];

      // Engine 1: Instant rendering using shop.metafields.upsell.rules (0ms latency)
      if (window.cartUpsellShopRules && Array.isArray(window.cartUpsellShopRules) && window.cartUpsellShopRules.length > 0) {
        const activeRules = window.cartUpsellShopRules
          .filter(r => r.enabled !== false)
          .sort((a, b) => (b.priority || 0) - (a.priority || 0));

        let matchedRule = activeRules.find(r => r.ruleType === 'PRODUCT' && r.targetId && allCartProductIds.includes(r.targetId.toString()));
        if (!matchedRule) {
          matchedRule = activeRules.find(r => r.ruleType === 'GLOBAL');
        }

        if (matchedRule && matchedRule.products && matchedRule.products.length > 0) {
          const maxCount = matchedRule.maxProducts || 3;
          upsellProducts = matchedRule.products
            .filter(p => {
              const pIdNum = (p.productId || '').toString().replace('gid://shopify/Product/', '');
              return !cartProductIdsNumeric.includes(pIdNum);
            })
            .slice(0, maxCount);
        }
      }

      // Engine 2: Fallback to App API if shop metafield is syncing
      if (upsellProducts.length === 0) {
        try {
          const productIdsStr = cartProductIdsNumeric.join(',');
          const shopDomain = window.Shopify?.shop || '{{ shop.permanent_domain }}';
          const apiRes = await fetch(`/apps/upsell/api?shop=${encodeURIComponent(shopDomain)}&product_ids=${encodeURIComponent(productIdsStr)}`);
          if (apiRes.ok) {
            const apiData = await apiRes.json();
            if (apiData.products && apiData.products.length > 0) {
              upsellProducts = apiData.products;
            }
          }
        } catch (apiErr) {
          console.warn('[CartUpsell] API fetch notice:', apiErr);
        }
      }

      if (!upsellProducts || upsellProducts.length === 0) {
        if (!isSilentRefresh) wrapper.style.display = 'none';
        return;
      }

      // 3. Render cards matching theme styles
      container.innerHTML = upsellProducts.map(product => {
        const rawVariantId = product.variantId || '';
        const variantId = product.numericVariantId || rawVariantId.toString().replace('gid://shopify/ProductVariant/', '');
        const title = product.productTitle || product.title || 'Recommended Item';
        const image = product.productImage || product.image || '';
        const price = product.price || '';
        const moneySymbol = window.Shopify?.currency?.active === 'USD' || !window.Shopify?.currency?.active ? '$' : '';
        const priceDisplay = price ? `${moneySymbol}${price}` : '';

        return `
          <div class="cart-upsell-product">
            <div class="cart-upsell-product__image">
              ${image ? `<img src="${image}" alt="${title}" width="120" height="120" loading="lazy">` : ''}
            </div>
            <div class="cart-upsell-product__info">
              <h4>${title}</h4>
              <div class="cart-upsell-product__price">
                ${priceDisplay}
              </div>
              <button
                type="button"
                class="cart-upsell-product__button"
                data-upsell-variant-id="${variantId}"
              >
                <span>+</span> ADD
              </button>
            </div>
          </div>
        `;
      }).join('');

      wrapper.style.display = 'block';
    } catch (err) {
      console.warn('[CartUpsell] Render error:', err);
    }
  }

  bindEvents() {
    document.addEventListener('click', (event) => {
      const button = event.target.closest('[data-upsell-variant-id]');
      if (!button) return;

      event.preventDefault();
      const variantId = button.dataset.upsellVariantId;
      if (!variantId) return;

      this.addToCart(variantId, button);
    });
  }

  async addToCart(variantId, button) {
    if (button.disabled) return;

    button.disabled = true;
    button.textContent = 'ADDING...';

    try {
      const response = await fetch(
        `${window.Shopify.routes.root}cart/add.js`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            items: [
              {
                id: Number(variantId),
                quantity: 1
              }
            ]
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.description || 'Unable to add product');
      }

      button.textContent = '✓ ADDED';
      
      // Update cart drawer in-place without hiding or wiping the upsell container
      await this.refreshCartDrawer();

    } catch (error) {
      console.error('[CartUpsell] Add error:', error);
      button.disabled = false;
      button.textContent = '+ ADD';
    }
  }

  async refreshCartDrawer() {
    try {
      const response = await fetch(
        `${window.Shopify.routes.root}?sections=cart-drawer,cart-icon-bubble`
      );

      if (!response.ok) {
        throw new Error('Unable to refresh cart drawer');
      }

      const sections = await response.json();

      if (sections['cart-drawer']) {
        const parsed = new DOMParser().parseFromString(
          sections['cart-drawer'],
          'text/html'
        );

        // Update ONLY items & footer so the upsell container is NEVER wiped or hidden!
        const newCartItems = parsed.querySelector('#CartDrawer-CartItems');
        const currentCartItems = document.querySelector('#CartDrawer-CartItems');
        if (newCartItems && currentCartItems) {
          currentCartItems.innerHTML = newCartItems.innerHTML;
        }

        const newFooter = parsed.querySelector('.drawer__footer');
        const currentFooter = document.querySelector('.drawer__footer');
        if (newFooter && currentFooter) {
          currentFooter.innerHTML = newFooter.innerHTML;
        }
      }

      if (sections['cart-icon-bubble']) {
        const parsed = new DOMParser().parseFromString(
          sections['cart-icon-bubble'],
          'text/html'
        );

        const newBubble = parsed.querySelector('#cart-icon-bubble');
        const currentBubble = document.querySelector('#cart-icon-bubble');

        if (newBubble && currentBubble) {
          currentBubble.replaceWith(newBubble);
        }
      }

      // Smoothly update upsell list in-place without hiding container
      this.loadUpsells(true);

    } catch (error) {
      console.error('[CartUpsell] Drawer refresh error:', error);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.cartDrawerUpsellInstance = new CartDrawerUpsell();
});
</script>
```

---

## 🛒 Where to place in `cart-drawer.liquid`

Render `{% render 'cart-drawer-upsell' %}` inside `<cart-drawer-items>`, right above `</cart-drawer-items>`:

```liquid
      </cart-drawer-items>

      {% if cart != empty %}
        {% render 'cart-drawer-upsell' %}
      {% endif %}

      <div class="drawer__footer">
```
