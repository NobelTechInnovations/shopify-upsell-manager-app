# 🚀 Deploying & Installing Cart Smart Upsell Manager on Any Shopify Store

This guide explains how to deploy your app to production so it can be installed on **any Shopify store or client website**.

---

## 🌐 1. Deploy the App Server to Production

You can deploy this Node.js app using Docker or any hosting platform (Render, Railway, Fly.io, Vercel, DigitalOcean, Heroku).

### Option A: Free/Easy Deployment with Render.com or Railway.app
1. Push your repository to **GitHub**.
2. Log into [Render.com](https://render.com) or [Railway.app](https://railway.app).
3. Create a new **Web Service** and connect your GitHub repo.
4. Set Build Command: `npm install && npm run build`
5. Set Start Command: `npm run docker-start`
6. Add Environment Variables:
   - `SHOPIFY_API_KEY` = `your-client-id-from-partner-dashboard`
   - `SHOPIFY_API_SECRET` = `your-client-secret-from-partner-dashboard`
   - `SCOPES` = `write_script_tags,read_script_tags,write_products,read_products`
   - `HOST` = `https://your-app-domain.onrender.com`
   - `DATABASE_URL` = `file:./dev.sqlite`

---

## ⚙️ 2. Configure Shopify Partner Dashboard

1. Go to your [Shopify Partner Dashboard](https://partners.shopify.com/).
2. Select your app (**Cart Smart**).
3. Go to **App Setup**:
   - **App URL**: `https://your-app-domain.com`
   - **Allowed redirection URL(s)**: `https://your-app-domain.com/api/auth/callback`
4. Go to **App Proxy**:
   - **Subpath prefix**: `apps`
   - **Subpath**: `upsell`
   - **Proxy URL**: `https://your-app-domain.com/api/upsells`
5. Save changes.

---

## 🛒 3. Install on Any Shopify Store / Client Website

Once deployed, any merchant can install your app using **Method A** (Direct Link) or **Method B** (Shopify App Store).

### Method A: Direct Install Link (No App Store required)
Share this install link with any client or store owner:

```
https://your-app-domain.com/api/auth?shop=STORE-NAME.myshopify.com
```

> Replace `STORE-NAME` with their shop domain (e.g. `my-awesome-store.myshopify.com`).
> When they open the link, Shopify will prompt them to authorize and install the app!

### Method B: Native Theme Integration Code for Clients
Give the client store owner this 1-line Liquid snippet to add to their `snippets/cart-drawer-upsell.liquid` or `layout/theme.liquid`:

```html
{% render 'cart-drawer-upsell' %}
```

Or for instant App Proxy script injection without editing code:
```html
<script src="/apps/upsell/script" defer="defer"></script>
```

---

## 🛠️ Summary Checklist for Installing on New Stores

- [x] App deployed & hosted on live HTTPS domain
- [x] Shopify Partner Dashboard App URL & Proxy configured
- [x] Direct Install Link generated for client store
- [x] Merchant opens install link & clicks "Install app"
- [x] Upsell rules created in Admin Dashboard
- [x] Tested on client store cart drawer!
