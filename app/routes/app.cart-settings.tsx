import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import prisma from "../db.server";

// ─── Loader ──────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  let settings = null;
  try {
    settings = await prisma.cartSettings.findUnique({
      where: { shop: session.shop },
    });
  } catch (e) {
    // Prisma client may be stale after schema migration — restart dev server to fix
    console.warn("[CartSettings] Prisma cartSettings not ready yet:", e);
  }
  return {
    settings,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    shop: session.shop,
  };
};

// ─── Action ──────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType") as string;

  if (actionType === "saveSettings") {
    const data: any = {};
    const intFields = ["borderRadius", "btnRadius", "upsellBtnRadius", "freeShippingThreshold", "fontSize"];
    const boolFields = ["upsellEnabled", "freeShippingEnabled", "cartReplacementEnabled"];

    for (const [key, val] of formData.entries()) {
      if (key === "actionType") continue;
      if (intFields.includes(key)) {
        data[key] = parseInt(val as string) || 0;
      } else if (boolFields.includes(key)) {
        data[key] = val === "true";
      } else {
        data[key] = val as string;
      }
    }

    let settings: any = null;
    try {
      settings = await prisma.cartSettings.upsert({
        where: { shop: session.shop },
        create: { shop: session.shop, ...data },
        update: data,
      });
    } catch (e: any) {
      console.warn("[CartSettings] Prisma upsert failed:", e);
      return { success: false, error: "DB not ready. Please restart the dev server and try again.", actionType: "saveSettings" };
    }

    // Sync to shop metafield so storefront script can access it instantly
    try {
      await admin.graphql(
        `#graphql
        mutation metafieldSet($metafields: [MetafieldSetInput!]!) {
          metafieldSet(metafields: $metafields) {
            metafields { id }
            userErrors { field message }
          }
        }`,
        {
          variables: {
            metafields: [
              {
                namespace: "cartsmart",
                key: "settings",
                type: "json",
                ownerId: `gid://shopify/Shop/${session.shop}`,
                value: JSON.stringify(settings),
              },
            ],
          },
        }
      );
    } catch (e) {
      console.error("Metafield sync failed:", e);
    }

    // If cart replacement is disabled, automatically clean up ScriptTag so native cart is restored
    if (data.cartReplacementEnabled === false) {
      try {
        const listRes = await admin.graphql(`#graphql
          query { scriptTags(first: 50) { edges { node { id src } } } }
        `);
        const listJson = await listRes.json();
        const tags = listJson.data?.scriptTags?.edges || [];
        for (const edge of tags) {
          if (edge.node.src.includes("cart-script") || edge.node.src.includes("cart-smart")) {
            await admin.graphql(`#graphql
              mutation deleteTag($id: ID!) { scriptTagDelete(id: $id) { deletedScriptTagId } }
            `, { variables: { id: edge.node.id } });
          }
        }
      } catch (e) {
        console.error("ScriptTag cleanup error:", e);
      }
    } else if (data.cartReplacementEnabled === true) {
      try {
        const scriptSrc = `https://${session.shop}/apps/upsell/script`;
        await admin.graphql(`#graphql
          mutation createScriptTag($input: ScriptTagInput!) {
            scriptTagCreate(input: $input) {
              scriptTag { id src }
            }
          }
        `, {
          variables: {
            input: { src: scriptSrc, displayScope: "ONLINE_STORE" }
          }
        });
      } catch (e) {
        console.error("ScriptTag auto-create error:", e);
      }
    }

    return { success: true, actionType: "saveSettings", settings };
  }

  return { success: false };
};

// ─── Default Settings ────────────────────────────────────────────────────────
const DEFAULTS = {
  cartReplacementEnabled: false,
  headerTitle: "Your Cart",
  headerBg: "#ffffff",
  headerTextColor: "#1a1a1a",
  bodyBg: "#ffffff",
  bodyTextColor: "#1a1a1a",
  borderColor: "#e5e7eb",
  borderRadius: 12,
  overlayBg: "rgba(0,0,0,0.5)",
  qtyBtnBg: "#f3f4f6",
  qtyBtnText: "#1a1a1a",
  btnBg: "#1a1a1a",
  btnText: "#ffffff",
  btnRadius: 6,
  checkoutBtnText: "Checkout",
  upsellEnabled: true,
  upsellTitle: "You might also like",
  upsellBg: "#f9fafb",
  upsellBtnBg: "#1a1a1a",
  upsellBtnText: "#ffffff",
  upsellBtnRadius: 4,
  freeShippingEnabled: false,
  freeShippingThreshold: 5000,
  freeShippingText: "Free shipping on orders over $50!",
  freeShippingBarBg: "#e5e7eb",
  freeShippingBarFill: "#22c55e",
  fontFamily: "inherit",
  fontSize: 14,
};

// ─── Component ────────────────────────────────────────────────────────────────
export default function CartSettingsPage() {
  const { settings: dbSettings, apiKey, shop } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [s, setS] = useState({ ...DEFAULTS, ...(dbSettings || {}) });
  const [installState, setInstallState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [installMsg, setInstallMsg] = useState("");
  const [tab, setTab] = useState<"header" | "body" | "buttons" | "upsell" | "shipping">("header");

  const isSaving = fetcher.state !== "idle" && fetcher.formData?.get("actionType") === "saveSettings";

  useEffect(() => {
    if (fetcher.data?.success && fetcher.data?.actionType === "saveSettings") {
      shopify?.toast?.show("Cart settings saved & synced!");
    }
  }, [fetcher.data, shopify]);

  const update = (key: string, val: any) => setS((prev) => ({ ...prev, [key]: val }));

  const handleSave = () => {
    const fd = new FormData();
    fd.append("actionType", "saveSettings");
    for (const [key, val] of Object.entries(s)) {
      fd.append(key, val === true ? "true" : val === false ? "false" : String(val));
    }
    fetcher.submit(fd, { method: "POST" });
  };

  const handleInstall = async () => {
    setInstallState("loading");
    setInstallMsg("Installing cart script...");
    try {
      const fd = new FormData();
      fd.append("actionType", "install");
      const res = await fetch("/app/api/install-cart", { method: "POST", body: fd });
      const data = await res.json();
      if (data.success) {
        setInstallState("done");
        setInstallMsg("✅ Cart script installed! Refresh your storefront to see the custom cart.");
      } else {
        setInstallState("error");
        setInstallMsg("❌ Install failed: " + (data.errors?.[0]?.message || data.error || "Unknown error"));
      }
    } catch (e: any) {
      setInstallState("error");
      setInstallMsg("❌ Install error: " + e.message);
    }
  };

  const handleUninstall = async () => {
    if (!confirm("Remove the CartSmart script from your storefront? The native cart will be restored.")) return;
    setInstallState("loading");
    setInstallMsg("Removing...");
    try {
      const fd = new FormData();
      fd.append("actionType", "uninstall");
      const res = await fetch("/app/api/install-cart", { method: "POST", body: fd });
      const data = await res.json();
      setInstallState(data.success ? "done" : "error");
      setInstallMsg(data.success ? "✅ Cart script removed. Native cart restored." : "❌ Remove failed.");
    } catch (e: any) {
      setInstallState("error");
      setInstallMsg("❌ Error: " + e.message);
    }
  };

  // ── Inline styles helpers ──
  const card = (extra?: any) => ({
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "16px",
    ...extra,
  });

  const label = { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", marginBottom: 6 } as const;
  const inputStyle = {
    width: "100%",
    padding: "8px 10px",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    fontSize: 14,
    boxSizing: "border-box" as const,
    background: "#fff",
  };
  const row = { display: "flex", gap: 14, alignItems: "flex-end" } as const;
  const col = { flex: 1 } as const;

  const ColorField = ({ label: lbl, field }: { label: string; field: string }) => (
    <div style={col}>
      <label style={label}>{lbl}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="color"
          value={(s as any)[field]}
          onChange={(e) => update(field, e.target.value)}
          style={{ width: 38, height: 38, border: "1px solid #d1d5db", borderRadius: 6, cursor: "pointer", padding: 2 }}
        />
        <input
          type="text"
          value={(s as any)[field]}
          onChange={(e) => update(field, e.target.value)}
          style={{ ...inputStyle, width: "auto", flex: 1 }}
        />
      </div>
    </div>
  );

  const NumberField = ({ label: lbl, field, min = 0, max = 100 }: { label: string; field: string; min?: number; max?: number }) => (
    <div style={col}>
      <label style={label}>{lbl}</label>
      <input
        type="number"
        value={(s as any)[field]}
        min={min}
        max={max}
        onChange={(e) => update(field, parseInt(e.target.value) || 0)}
        style={inputStyle}
      />
    </div>
  );

  const TextField = ({ label: lbl, field, placeholder = "" }: { label: string; field: string; placeholder?: string }) => (
    <div>
      <label style={label}>{lbl}</label>
      <input
        type="text"
        value={(s as any)[field]}
        placeholder={placeholder}
        onChange={(e) => update(field, e.target.value)}
        style={inputStyle}
      />
    </div>
  );

  const Toggle = ({ label: lbl, field }: { label: string; field: string }) => (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
      <div
        onClick={() => update(field, !(s as any)[field])}
        style={{
          width: 42, height: 24, borderRadius: 99,
          background: (s as any)[field] ? "#008060" : "#d1d5db",
          position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0,
        }}
      >
        <div style={{
          position: "absolute", top: 3, left: (s as any)[field] ? 21 : 3,
          width: 18, height: 18, borderRadius: "50%",
          background: "#fff", transition: "left 0.2s",
          boxShadow: "0 1px 4px rgba(0,0,0,0.18)",
        }} />
      </div>
      <span style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>{lbl}</span>
    </label>
  );

  const TABS = [
    { id: "header", label: "🏷 Header" },
    { id: "body", label: "🎨 Body" },
    { id: "buttons", label: "🔘 Buttons" },
    { id: "upsell", label: "✨ Upsell" },
    { id: "shipping", label: "🚚 Shipping Bar" },
  ] as const;

  // ─── Live Cart Preview ─────────────────────────────────────────────────────
  const Preview = () => (
    <div style={{
      position: "sticky", top: 20,
      background: "#f3f4f6",
      borderRadius: 12,
      padding: 12,
      border: "1px solid #e5e7eb",
    }}>
      <p style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "#6b7280", letterSpacing: "0.6px" }}>
        Live Preview
      </p>
      <div style={{
        width: "100%",
        background: s.bodyBg,
        borderRadius: s.borderRadius,
        boxShadow: "0 8px 24px rgba(0,0,0,0.13)",
        overflow: "hidden",
        fontFamily: s.fontFamily === "inherit" ? "sans-serif" : s.fontFamily,
        fontSize: s.fontSize,
        color: s.bodyTextColor,
        border: `1px solid ${s.borderColor}`,
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 16px",
          background: s.headerBg, color: s.headerTextColor,
          borderBottom: `1px solid ${s.borderColor}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{s.headerTitle}</span>
            <span style={{
              background: s.btnBg, color: s.btnText,
              borderRadius: 99, minWidth: 20, height: 20,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700, padding: "0 5px",
            }}>2</span>
          </div>
          <span style={{ fontSize: 18, opacity: 0.6, cursor: "pointer" }}>✕</span>
        </div>

        {/* Free shipping bar */}
        {s.freeShippingEnabled && (
          <div style={{ padding: "10px 16px", borderBottom: `1px solid ${s.borderColor}` }}>
            <p style={{ margin: "0 0 6px", fontSize: 11, textAlign: "center" }}>Spend $20.00 more for {s.freeShippingText}</p>
            <div style={{ height: 5, borderRadius: 99, background: s.freeShippingBarBg, overflow: "hidden" }}>
              <div style={{ height: "100%", width: "60%", background: s.freeShippingBarFill, borderRadius: 99 }} />
            </div>
          </div>
        )}

        {/* Cart item */}
        <div style={{ padding: "12px 16px", borderBottom: `1px solid ${s.borderColor}`, display: "flex", gap: 10 }}>
          <div style={{ width: 56, height: 56, borderRadius: 6, background: "#e5e7eb", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>Sample Product</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 6 }}>Blue / M</div>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>$29.99</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", border: `1px solid ${s.borderColor}`, borderRadius: 6, overflow: "hidden" }}>
                <button style={{ background: s.qtyBtnBg, color: s.qtyBtnText, border: "none", width: 28, height: 28, cursor: "pointer", fontSize: 14 }}>−</button>
                <span style={{ minWidth: 28, textAlign: "center", fontSize: 13, fontWeight: 600, lineHeight: "28px" }}>1</span>
                <button style={{ background: s.qtyBtnBg, color: s.qtyBtnText, border: "none", width: 28, height: 28, cursor: "pointer", fontSize: 14 }}>+</button>
              </div>
              <span style={{ fontSize: 11, opacity: 0.5, textDecoration: "underline", cursor: "pointer" }}>Remove</span>
            </div>
          </div>
        </div>

        {/* Upsell */}
        {s.upsellEnabled && (
          <div style={{ padding: "10px 0", background: s.upsellBg, borderBottom: `1px solid ${s.borderColor}` }}>
            <p style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.6px", opacity: 0.6, padding: "0 16px" }}>
              {s.upsellTitle}
            </p>
            <div style={{ display: "flex", gap: 8, padding: "0 16px", overflowX: "hidden" }}>
              {[1, 2].map((i) => (
                <div key={i} style={{
                  flexShrink: 0, width: 100,
                  background: s.bodyBg, border: `1px solid ${s.borderColor}`, borderRadius: 7, overflow: "hidden",
                }}>
                  <div style={{ height: 70, background: "#e5e7eb" }} />
                  <div style={{ padding: "5px 6px 2px" }}>
                    <div style={{ fontSize: 10, fontWeight: 600, marginBottom: 2, overflow: "hidden", whiteSpace: "nowrap" }}>Upsell Product {i}</div>
                    <div style={{ fontSize: 10, fontWeight: 700 }}>$19.99</div>
                  </div>
                  <button style={{
                    display: "block", width: "calc(100% - 12px)", margin: "4px 6px 6px",
                    background: s.upsellBtnBg, color: s.upsellBtnText,
                    border: "none", borderRadius: s.upsellBtnRadius, fontSize: 10, fontWeight: 700, padding: "5px 0", cursor: "pointer",
                  }}>+ ADD</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 13, opacity: 0.7 }}>Subtotal</span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>$59.98</span>
          </div>
          <button style={{
            display: "block", width: "100%",
            background: s.btnBg, color: s.btnText,
            border: "none", borderRadius: s.btnRadius, fontSize: 14, fontWeight: 700,
            padding: "12px 0", cursor: "pointer",
          }}>{s.checkoutBtnText} →</button>
          <button style={{
            display: "block", width: "100%", background: "none", border: "none",
            marginTop: 8, fontSize: 11, color: s.bodyTextColor, opacity: 0.5, cursor: "pointer", textDecoration: "underline",
          }}>Continue shopping</button>
        </div>
      </div>
    </div>
  );

  // ─── Mode Switch Banner ───────────────────────────────────────────────────
  const InstallBanner = () => (
    <div
      style={card({
        marginBottom: 20,
        background: s.cartReplacementEnabled ? "#f0fdf4" : "#f9fafb",
        borderColor: s.cartReplacementEnabled ? "#bbf7d0" : "#d1d5db",
      })}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 20 }}>{s.cartReplacementEnabled ? "⚡" : "🎨"}</span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#111827" }}>
                {s.cartReplacementEnabled
                  ? "App Custom Cart Drawer Mode (ON)"
                  : "Native Theme Cart Mode (OFF — Recommended for Custom Liquid Code)"}
              </h3>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "#4b5563" }}>
              {s.cartReplacementEnabled
                ? "The app automatically replaces your theme's native cart drawer with the customizable drawer."
                : "The app script is OFF. Your native Shopify cart drawer and custom code design (snippets/cart-drawer-upsell.liquid) will be used."}
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <Toggle
              label={s.cartReplacementEnabled ? "Custom Cart ON" : "Custom Cart OFF"}
              field="cartReplacementEnabled"
            />
          </div>
        </div>

        {!s.cartReplacementEnabled && (
          <div style={{ background: "#ffffff", padding: 12, borderRadius: 6, border: "1px solid #e5e7eb", fontSize: 12, color: "#374151" }}>
            ✅ <strong>Native Cart Mode Active:</strong> Upsell Manager works directly with your custom theme design. No script replacement is injected onto your storefront.
          </div>
        )}

        {s.cartReplacementEnabled && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#ffffff", padding: 12, borderRadius: 6, border: "1px solid #bbf7d0" }}>
            <span style={{ fontSize: 12, color: "#065f46" }}>
              {installMsg || "Custom cart script will be active on storefront after saving."}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={handleInstall}
                disabled={installState === "loading"}
                style={{
                  background: "#008060", color: "#fff", border: "none",
                  padding: "6px 12px", borderRadius: 4, fontSize: 12, fontWeight: 700,
                  cursor: installState === "loading" ? "not-allowed" : "pointer",
                }}
              >
                {installState === "loading" ? "Working..." : "Re-sync ScriptTag"}
              </button>
              <button
                onClick={handleUninstall}
                style={{
                  background: "#fff", color: "#dc2626", border: "1px solid #fca5a5",
                  padding: "6px 10px", borderRadius: 4, fontSize: 12, fontWeight: 600, cursor: "pointer",
                }}
              >
                Remove
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Upsell Manager</s-link>
        <s-link href="/app/cart-settings">Cart Settings</s-link>
      </s-app-nav>

      <s-page heading="Cart Theme Editor">
        <s-button slot="primary-action" variant="primary" onClick={handleSave}>
          {isSaving ? "Saving..." : "💾 Save & Sync"}
        </s-button>

        <div style={{ padding: "0 0 40px" }}>
          <InstallBanner />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>
            {/* Left panel — settings */}
            <div>
              {/* Tab nav */}
              <div style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #e5e7eb", paddingBottom: 0 }}>
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      padding: "8px 14px", fontSize: 13, fontWeight: 600,
                      color: tab === t.id ? "#008060" : "#6b7280",
                      borderBottom: tab === t.id ? "2px solid #008060" : "2px solid transparent",
                      marginBottom: -1, borderRadius: "4px 4px 0 0",
                      transition: "color 0.15s",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Header tab */}
              {tab === "header" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={card()}>
                    <h4 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Header</h4>
                    <TextField label="Cart Title" field="headerTitle" placeholder="Your Cart" />
                    <div style={{ ...row, marginTop: 12 }}>
                      <ColorField label="Header Background" field="headerBg" />
                      <ColorField label="Header Text Color" field="headerTextColor" />
                    </div>
                  </div>
                  <div style={card()}>
                    <h4 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Typography</h4>
                    <div style={row}>
                      <div style={col}>
                        <label style={label}>Font Family</label>
                        <select
                          value={s.fontFamily}
                          onChange={(e) => update("fontFamily", e.target.value)}
                          style={{ ...inputStyle }}
                        >
                          <option value="inherit">Theme Default</option>
                          <option value="'Inter', sans-serif">Inter</option>
                          <option value="'Roboto', sans-serif">Roboto</option>
                          <option value="'Poppins', sans-serif">Poppins</option>
                          <option value="'Montserrat', sans-serif">Montserrat</option>
                          <option value="'Lato', sans-serif">Lato</option>
                          <option value="'Playfair Display', serif">Playfair Display</option>
                          <option value="'DM Sans', sans-serif">DM Sans</option>
                          <option value="'Nunito', sans-serif">Nunito</option>
                        </select>
                      </div>
                      <NumberField label="Base Font Size (px)" field="fontSize" min={10} max={20} />
                    </div>
                  </div>
                </div>
              )}

              {/* Body tab */}
              {tab === "body" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={card()}>
                    <h4 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Cart Body</h4>
                    <div style={{ ...row, marginBottom: 12 }}>
                      <ColorField label="Body Background" field="bodyBg" />
                      <ColorField label="Body Text Color" field="bodyTextColor" />
                    </div>
                    <div style={{ ...row, marginBottom: 12 }}>
                      <ColorField label="Border / Divider Color" field="borderColor" />
                      <NumberField label="Border Radius (px)" field="borderRadius" min={0} max={32} />
                    </div>
                    <div>
                      <label style={label}>Overlay Background</label>
                      <input
                        type="text"
                        value={s.overlayBg}
                        onChange={(e) => update("overlayBg", e.target.value)}
                        placeholder="rgba(0,0,0,0.5)"
                        style={inputStyle}
                      />
                    </div>
                  </div>
                  <div style={card()}>
                    <h4 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Quantity Stepper</h4>
                    <div style={row}>
                      <ColorField label="Qty Button Background" field="qtyBtnBg" />
                      <ColorField label="Qty Button Text Color" field="qtyBtnText" />
                    </div>
                  </div>
                </div>
              )}

              {/* Buttons tab */}
              {tab === "buttons" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={card()}>
                    <h4 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Checkout Button</h4>
                    <TextField label="Button Text" field="checkoutBtnText" placeholder="Checkout" />
                    <div style={{ ...row, marginTop: 12 }}>
                      <ColorField label="Button Background" field="btnBg" />
                      <ColorField label="Button Text Color" field="btnText" />
                    </div>
                    <div style={{ marginTop: 12 }}>
                      <NumberField label="Button Border Radius (px)" field="btnRadius" min={0} max={99} />
                    </div>
                  </div>
                </div>
              )}

              {/* Upsell tab */}
              {tab === "upsell" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={card()}>
                    <h4 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Upsell Section</h4>
                    <div style={{ marginBottom: 14 }}>
                      <Toggle label="Enable upsell section in cart" field="upsellEnabled" />
                    </div>
                    {s.upsellEnabled && (
                      <>
                        <TextField label="Section Title" field="upsellTitle" placeholder="You might also like" />
                        <div style={{ ...row, marginTop: 12, marginBottom: 12 }}>
                          <ColorField label="Section Background" field="upsellBg" />
                          <ColorField label="Add Button Background" field="upsellBtnBg" />
                        </div>
                        <div style={{ ...row, marginBottom: 12 }}>
                          <ColorField label="Add Button Text Color" field="upsellBtnText" />
                          <NumberField label="Button Border Radius (px)" field="upsellBtnRadius" min={0} max={99} />
                        </div>
                        <div style={{
                          background: "#eff6ff",
                          border: "1px solid #bfdbfe",
                          borderRadius: 6,
                          padding: 10,
                          fontSize: 12,
                          color: "#1d4ed8",
                        }}>
                          💡 Upsell products are pulled automatically from your <strong>Upsell Manager</strong> rules.
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Shipping bar tab */}
              {tab === "shipping" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={card()}>
                    <h4 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Free Shipping Progress Bar</h4>
                    <div style={{ marginBottom: 14 }}>
                      <Toggle label="Show free shipping progress bar" field="freeShippingEnabled" />
                    </div>
                    {s.freeShippingEnabled && (
                      <>
                        <div style={{ marginBottom: 12 }}>
                          <label style={label}>Threshold (in cents, e.g. 5000 = $50.00)</label>
                          <input
                            type="number"
                            value={s.freeShippingThreshold}
                            min={0}
                            onChange={(e) => update("freeShippingThreshold", parseInt(e.target.value) || 0)}
                            style={inputStyle}
                          />
                          <span style={{ fontSize: 11, color: "#6b7280" }}>
                            = {(s.freeShippingThreshold / 100).toFixed(2)} in your currency
                          </span>
                        </div>
                        <TextField label="Progress Message" field="freeShippingText" placeholder="Free shipping on orders over $50!" />
                        <div style={{ ...row, marginTop: 12 }}>
                          <ColorField label="Bar Background" field="freeShippingBarBg" />
                          <ColorField label="Bar Fill Color" field="freeShippingBarFill" />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Save */}
              <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  style={{
                    background: isSaving ? "#6b7280" : "#008060",
                    color: "#fff", border: "none",
                    padding: "10px 24px", borderRadius: 6, fontSize: 14, fontWeight: 700,
                    cursor: isSaving ? "not-allowed" : "pointer",
                    boxShadow: "0 2px 4px rgba(0,128,96,0.2)",
                  }}
                >
                  {isSaving ? "Saving..." : "💾 Save & Sync"}
                </button>
              </div>
            </div>

            {/* Right panel — Live Preview */}
            <Preview />
          </div>
        </div>
      </s-page>
    </AppProvider>
  );
}

export const headers = (headersArgs: any) => boundary.headers(headersArgs);
