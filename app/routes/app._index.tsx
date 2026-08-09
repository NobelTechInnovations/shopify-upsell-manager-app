import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import prisma from "../db.server";

// Helper function to sync active rules to shop metafield (namespace: "upsell", key: "rules")
async function syncRulesToMetafield(admin: any, shop: string) {
  try {
    const rules = await prisma.upsellRule.findMany({
      where: { shop, enabled: true },
      include: { products: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });

    const rulesData = rules.map((rule) => ({
      id: rule.id,
      shop: rule.shop,
      name: rule.name,
      ruleType: rule.ruleType,
      targetId: rule.targetId,
      targetTitle: rule.targetTitle,
      priority: rule.priority,
      maxProducts: rule.maxProducts,
      enabled: rule.enabled,
      products: rule.products.map((p) => ({
        productId: p.productId,
        productTitle: p.productTitle,
        productImage: p.productImage,
        price: p.price,
        variantId: p.variantId,
        sortOrder: p.sortOrder,
      })),
    }));

    await admin.graphql(
      `#graphql
      mutation metafieldSet($metafields: [MetafieldSetInput!]!) {
        metafieldSet(metafields: $metafields) {
          metafields {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          metafields: [
            {
              namespace: "upsell",
              key: "rules",
              type: "json",
              ownerId: `gid://shopify/Shop/${shop}`,
              value: JSON.stringify(rulesData),
            },
          ],
        },
      }
    );
  } catch (err) {
    console.error("Failed to sync rules to metafield:", err);
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const rules = await prisma.upsellRule.findMany({
    where: { shop: session.shop },
    include: { products: { orderBy: { sortOrder: "asc" } } },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  return { rules, apiKey: process.env.SHOPIFY_API_KEY || "0859f7f7217d0f7402f7201130710a40", shop: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType") as string;

  if (actionType === "createRule" || actionType === "updateRule") {
    const ruleId = formData.get("ruleId") as string | null;
    const name = (formData.get("name") as string) || "Untitled Rule";
    const ruleType = (formData.get("ruleType") as "GLOBAL" | "COLLECTION" | "PRODUCT") || "GLOBAL";
    const targetId = (formData.get("targetId") as string) || null;
    const targetTitle = (formData.get("targetTitle") as string) || null;
    const priority = parseInt(formData.get("priority") as string) || 0;
    const maxProducts = parseInt(formData.get("maxProducts") as string) || 3;
    const enabled = formData.get("enabled") === "true" || formData.get("enabled") === "on";

    const productsJsonRaw = (formData.get("productsJson") as string) || "[]";
    let productsList: Array<{
      productId: string;
      productTitle?: string;
      productImage?: string;
      price?: string;
      variantId?: string;
    }> = [];

    try {
      productsList = JSON.parse(productsJsonRaw);
    } catch {
      productsList = [];
    }

    if (actionType === "updateRule" && ruleId) {
      await prisma.upsellRuleProduct.deleteMany({ where: { ruleId } });
      const updatedRule = await prisma.upsellRule.update({
        where: { id: ruleId, shop: session.shop },
        data: {
          name,
          ruleType,
          targetId: targetId || null,
          targetTitle: targetTitle || null,
          priority,
          maxProducts,
          enabled,
          products: {
            create: productsList.map((prod, index) => ({
              productId: prod.productId,
              productTitle: prod.productTitle || null,
              productImage: prod.productImage || null,
              price: prod.price || null,
              variantId: prod.variantId || null,
              sortOrder: index,
            })),
          },
        },
        include: { products: true },
      });

      await syncRulesToMetafield(admin, session.shop);
      return { success: true, rule: updatedRule, actionType: "update" };
    } else {
      const createdRule = await prisma.upsellRule.create({
        data: {
          shop: session.shop,
          name,
          ruleType,
          targetId: targetId || null,
          targetTitle: targetTitle || null,
          priority,
          maxProducts,
          enabled,
          products: {
            create: productsList.map((prod, index) => ({
              productId: prod.productId,
              productTitle: prod.productTitle || null,
              productImage: prod.productImage || null,
              price: prod.price || null,
              variantId: prod.variantId || null,
              sortOrder: index,
            })),
          },
        },
        include: { products: true },
      });

      await syncRulesToMetafield(admin, session.shop);
      return { success: true, rule: createdRule, actionType: "create" };
    }
  }

  if (actionType === "deleteRule") {
    const ruleId = formData.get("ruleId") as string;
    await prisma.upsellRule.delete({
      where: { id: ruleId, shop: session.shop },
    });
    await syncRulesToMetafield(admin, session.shop);
    return { success: true, actionType: "delete" };
  }

  if (actionType === "toggleRule") {
    const ruleId = formData.get("ruleId") as string;
    const rule = await prisma.upsellRule.findUnique({
      where: { id: ruleId, shop: session.shop },
    });
    if (rule) {
      await prisma.upsellRule.update({
        where: { id: ruleId },
        data: { enabled: !rule.enabled },
      });
    }
    await syncRulesToMetafield(admin, session.shop);
    return { success: true, actionType: "toggle" };
  }

  return { success: false, error: "Invalid action" };
};

export default function Index() {
  const { rules, apiKey, shop } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<any | null>(null);

  // Form State
  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState<"GLOBAL" | "COLLECTION" | "PRODUCT">("GLOBAL");
  const [targetId, setTargetId] = useState("");
  const [targetTitle, setTargetTitle] = useState("");
  const [priority, setPriority] = useState<number>(0);
  const [maxProducts, setMaxProducts] = useState<number>(3);
  const [enabled, setEnabled] = useState(true);
  const [selectedProducts, setSelectedProducts] = useState<Array<{
    productId: string;
    productTitle: string;
    productImage?: string;
    price?: string;
    variantId?: string;
  }>>([]);

  // Search state for Target (Collection/Product)
  const [targetSearchQuery, setTargetSearchQuery] = useState("");
  const [targetSearchResults, setTargetSearchResults] = useState<any[]>([]);
  const [targetSearchLoading, setTargetSearchLoading] = useState(false);

  // Search state for Upsell Products
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  useEffect(() => {
    if (fetcher.data?.success) {
      if (fetcher.data.actionType === "create") {
        if (shopify?.toast) shopify.toast.show("Upsell rule created!");
        closeModal();
      } else if (fetcher.data.actionType === "update") {
        if (shopify?.toast) shopify.toast.show("Upsell rule updated!");
        closeModal();
      } else if (fetcher.data.actionType === "delete") {
        if (shopify?.toast) shopify.toast.show("Rule deleted!");
      } else if (fetcher.data.actionType === "toggle") {
        if (shopify?.toast) shopify.toast.show("Rule status updated!");
      }
    }
  }, [fetcher.data, shopify]);

  const openCreateModal = () => {
    setEditingRule(null);
    setRuleName("");
    setRuleType("GLOBAL");
    setTargetId("");
    setTargetTitle("");
    setPriority(0);
    setMaxProducts(3);
    setEnabled(true);
    setSelectedProducts([]);
    setSearchQuery("");
    setSearchResults([]);
    setTargetSearchQuery("");
    setTargetSearchResults([]);
    setModalOpen(true);
  };

  const openEditModal = (rule: any) => {
    setEditingRule(rule);
    setRuleName(rule.name || "");
    setRuleType(rule.ruleType || "GLOBAL");
    setTargetId(rule.targetId || "");
    setTargetTitle(rule.targetTitle || "");
    setPriority(rule.priority || 0);
    setMaxProducts(rule.maxProducts || 3);
    setEnabled(rule.enabled ?? true);
    setSelectedProducts(
      (rule.products || []).map((p: any) => ({
        productId: p.productId,
        productTitle: p.productTitle || p.productId,
        productImage: p.productImage || "",
        price: p.price || "",
        variantId: p.variantId || "",
      }))
    );
    setSearchQuery("");
    setSearchResults([]);
    setTargetSearchQuery("");
    setTargetSearchResults([]);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingRule(null);
  };

  // App Bridge Native Resource Pickers
  const selectTargetResource = async () => {
    try {
      if (shopify && (shopify as any).resourcePicker) {
        if (ruleType === "COLLECTION") {
          const selected = await (shopify as any).resourcePicker({
            type: "collection",
            multiple: false,
          });
          if (selected && selected.length > 0) {
            setTargetId(selected[0].id);
            setTargetTitle(selected[0].title);
          }
        } else if (ruleType === "PRODUCT") {
          const selected = await (shopify as any).resourcePicker({
            type: "product",
            multiple: false,
          });
          if (selected && selected.length > 0) {
            setTargetId(selected[0].id);
            setTargetTitle(selected[0].title);
          }
        }
      }
    } catch (err) {
      console.warn("Resource picker exception:", err);
    }
  };

  const selectUpsellProductsWithPicker = async () => {
    try {
      if (shopify && (shopify as any).resourcePicker) {
        const selected = await (shopify as any).resourcePicker({
          type: "product",
          multiple: true,
          selectionIds: selectedProducts.map((p) => ({ id: p.productId })),
        });
        if (selected && selected.length > 0) {
          const formatted = selected.map((prod: any) => {
            const firstVariant = prod.variants?.[0] || {};
            const imageObj = prod.images?.[0] || prod.featuredImage || {};
            return {
              productId: prod.id,
              productTitle: prod.title,
              productImage: imageObj.originalSrc || imageObj.url || "",
              price: firstVariant.price || "",
              variantId: firstVariant.id || "",
            };
          });

          const existingIds = new Set(selectedProducts.map((p) => p.productId));
          const newProducts = [...selectedProducts];
          for (const item of formatted) {
            if (!existingIds.has(item.productId)) {
              newProducts.push(item);
            }
          }
          setSelectedProducts(newProducts);
        }
      }
    } catch (err) {
      console.warn("Product picker exception:", err);
    }
  };

  // Search Target (Collection / Product)
  const handleTargetSearch = async (query: string) => {
    setTargetSearchQuery(query);
    if (!query.trim()) {
      setTargetSearchResults([]);
      return;
    }
    setTargetSearchLoading(true);
    try {
      const typeParam = ruleType === "COLLECTION" ? "collection" : "product";
      const res = await fetch(`/app/api/search?query=${encodeURIComponent(query)}&type=${typeParam}`);
      const data = await res.json();
      setTargetSearchResults(ruleType === "COLLECTION" ? data.collections || [] : data.products || []);
    } catch (err) {
      console.error(err);
    } finally {
      setTargetSearchLoading(false);
    }
  };

  const selectTargetFromSearch = (item: any) => {
    setTargetId(item.id);
    setTargetTitle(item.title);
    setTargetSearchQuery("");
    setTargetSearchResults([]);
  };

  // Search Upsell Product
  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    try {
      const res = await fetch(`/app/api/search?query=${encodeURIComponent(query)}&type=product`);
      const data = await res.json();
      setSearchResults(data.products || []);
    } catch (err) {
      console.error(err);
    } finally {
      setSearchLoading(false);
    }
  };

  const addSearchProduct = (prod: any) => {
    if (!selectedProducts.some((p) => p.productId === prod.id)) {
      setSelectedProducts([
        ...selectedProducts,
        {
          productId: prod.id,
          productTitle: prod.title,
          productImage: prod.image || "",
          price: prod.price || "",
          variantId: prod.variantId || "",
        },
      ]);
    }
    setSearchQuery("");
    setSearchResults([]);
  };

  const removeSelectedProduct = (productId: string) => {
    setSelectedProducts(selectedProducts.filter((p) => p.productId !== productId));
  };

  const handleSaveRule = () => {
    if (!ruleName.trim()) {
      alert("Please enter a rule name");
      return;
    }
    if ((ruleType === "COLLECTION" || ruleType === "PRODUCT") && !targetId) {
      alert(`Please select a target ${ruleType.toLowerCase()}`);
      return;
    }
    if (selectedProducts.length === 0) {
      alert("Please select at least one upsell product");
      return;
    }

    const formDataObj = new FormData();
    formDataObj.append("actionType", editingRule ? "updateRule" : "createRule");
    if (editingRule) {
      formDataObj.append("ruleId", editingRule.id);
    }
    formDataObj.append("name", ruleName);
    formDataObj.append("ruleType", ruleType);
    formDataObj.append("targetId", targetId);
    formDataObj.append("targetTitle", targetTitle);
    formDataObj.append("priority", priority.toString());
    formDataObj.append("maxProducts", maxProducts.toString());
    formDataObj.append("enabled", enabled ? "true" : "false");
    formDataObj.append("productsJson", JSON.stringify(selectedProducts));

    fetcher.submit(formDataObj, { method: "POST" });
  };

  const handleToggle = (ruleId: string) => {
    const fd = new FormData();
    fd.append("actionType", "toggleRule");
    fd.append("ruleId", ruleId);
    fetcher.submit(fd, { method: "POST" });
  };

  const handleDelete = (ruleId: string) => {
    if (confirm("Are you sure you want to delete this upsell rule?")) {
      const fd = new FormData();
      fd.append("actionType", "deleteRule");
      fd.append("ruleId", ruleId);
      fetcher.submit(fd, { method: "POST" });
    }
  };

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Upsell Manager</s-link>
        <s-link href="/app/cart-settings">Cart Settings</s-link>
      </s-app-nav>

      <s-page heading="Cart Drawer Upsell Manager">
        <s-button slot="primary-action" variant="primary" onClick={openCreateModal}>
          + Create New Rule
        </s-button>

        {/* Banners row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "24px" }}>
          {/* Cart Mode Banner */}
          <div
            style={{
              padding: "16px",
              background: "#ffffff",
              borderRadius: "10px",
              border: "1px solid #d1d5db",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "22px" }}>🎨</span>
              <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#111827" }}>Native Theme Cart Mode</h3>
            </div>
            <p style={{ margin: 0, fontSize: "12px", color: "#4b5563" }}>
              Using your custom theme code design (`snippets/cart-drawer-upsell.liquid`). Upsell rules work 100% directly with your native cart drawer.
            </p>
            <a
              href="/app/cart-settings"
              style={{
                display: "inline-block",
                background: "#f3f4f6",
                color: "#111827",
                border: "1px solid #d1d5db",
                textDecoration: "none",
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 600,
                alignSelf: "flex-start",
                marginTop: "4px",
              }}
            >
              Cart Settings & Mode Toggle →
            </a>
          </div>

          {/* API Info Banner */}
          <div
            style={{
              padding: "16px",
              background: "#f4f6f8",
              borderRadius: "10px",
              border: "1px solid #d2d6dc",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "22px" }}>🚀</span>
              <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#1a1a1a" }}>Upsell API Ready</h3>
            </div>
            <p style={{ margin: "0", fontSize: "12px", color: "#5c5f62" }}>
              Upsell products are served dynamically via the app proxy:
            </p>
            <code
              style={{
                background: "#e1e3e5",
                padding: "4px 8px",
                borderRadius: "4px",
                fontSize: "11px",
                fontFamily: "monospace",
                display: "block",
                overflowX: "auto",
                wordBreak: "break-all",
              }}
            >
              /apps/upsell/api?shop={shop}&product_ids=...
            </code>
          </div>
        </div>

        {/* Rules Table */}
        <s-section heading={`All Upsell Rules (${rules.length})`}>
          {rules.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 24px" }}>
              <div style={{ fontSize: "40px", marginBottom: "12px" }}>🛍️</div>
              <div style={{ fontSize: "18px", fontWeight: 600, color: "#202223" }}>
                No upsell rules created yet
              </div>
              <p style={{ marginTop: "8px", color: "#6d7175", fontSize: "14px" }}>
                Create rules to show personalized product offers in your native cart drawer based on global rules, specific products, or collections.
              </p>
              <div style={{ marginTop: "16px" }}>
                <button
                  type="button"
                  onClick={openCreateModal}
                  style={{
                    background: "#008060",
                    color: "#ffffff",
                    border: "none",
                    padding: "10px 20px",
                    borderRadius: "6px",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                  }}
                >
                  + Create Your First Rule
                </button>
              </div>
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #e1e3e5", background: "#fafafa" }}>
                    <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "12px", color: "#6d7175", textTransform: "uppercase" }}>Rule Name</th>
                    <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "12px", color: "#6d7175", textTransform: "uppercase" }}>Target</th>
                    <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "12px", color: "#6d7175", textTransform: "uppercase" }}>Upsells</th>
                    <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "12px", color: "#6d7175", textTransform: "uppercase" }}>Priority</th>
                    <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "12px", color: "#6d7175", textTransform: "uppercase" }}>Status</th>
                    <th style={{ padding: "12px 16px", fontWeight: 600, fontSize: "12px", color: "#6d7175", textTransform: "uppercase", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} style={{ borderBottom: "1px solid #e1e3e5" }}>
                      <td style={{ padding: "14px 16px", fontWeight: 600, color: "#202223" }}>
                        {rule.name}
                      </td>

                      <td style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                            padding: "4px 8px",
                            borderRadius: "4px",
                            fontSize: "12px",
                            fontWeight: 500,
                            background: rule.ruleType === "GLOBAL" ? "#e4e5e7" : rule.ruleType === "COLLECTION" ? "#e0f2fe" : "#fef3c7",
                            color: rule.ruleType === "GLOBAL" ? "#202223" : rule.ruleType === "COLLECTION" ? "#0369a1" : "#b45309",
                          }}
                        >
                          {rule.ruleType === "GLOBAL" && "🌐 All Products"}
                          {rule.ruleType === "COLLECTION" && `📁 ${rule.targetTitle || "Collection"}`}
                          {rule.ruleType === "PRODUCT" && `🏷️ ${rule.targetTitle || "Product"}`}
                        </span>
                      </td>

                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          {rule.products.slice(0, 3).map((p: any) => (
                            <div key={p.id} title={p.productTitle || p.productId} style={{ display: "inline-block" }}>
                              {p.productImage ? (
                                <img
                                  src={p.productImage}
                                  alt=""
                                  style={{ width: 32, height: 32, borderRadius: "4px", objectFit: "cover", border: "1px solid #e1e3e5" }}
                                />
                              ) : (
                                <div style={{ width: 32, height: 32, borderRadius: "4px", background: "#f1f2f3", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px" }}>
                                  📦
                                </div>
                              )}
                            </div>
                          ))}
                          <span style={{ fontSize: "13px", color: "#6d7175", marginLeft: "4px" }}>
                            ({rule.products.length} product{rule.products.length !== 1 ? "s" : ""})
                          </span>
                        </div>
                      </td>

                      <td style={{ padding: "14px 16px", fontSize: "13px", color: "#202223" }}>
                        {rule.priority}
                      </td>

                      <td style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            padding: "3px 8px",
                            borderRadius: "12px",
                            fontSize: "12px",
                            fontWeight: 600,
                            background: rule.enabled ? "#d1fae5" : "#fee2e2",
                            color: rule.enabled ? "#065f46" : "#991b1b",
                          }}
                        >
                          {rule.enabled ? "Active" : "Inactive"}
                        </span>
                      </td>

                      <td style={{ padding: "14px 16px", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "8px" }}>
                          <button
                            type="button"
                            onClick={() => openEditModal(rule)}
                            style={{ background: "#ffffff", border: "1px solid #c9cccf", padding: "4px 8px", borderRadius: "4px", fontSize: "12px", cursor: "pointer" }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggle(rule.id)}
                            style={{ background: "#ffffff", border: "1px solid #c9cccf", padding: "4px 8px", borderRadius: "4px", fontSize: "12px", cursor: "pointer" }}
                          >
                            {rule.enabled ? "Deactivate" : "Activate"}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(rule.id)}
                            style={{ background: "#ffffff", border: "1px solid #d32f2f", color: "#d32f2f", padding: "4px 8px", borderRadius: "4px", fontSize: "12px", cursor: "pointer" }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </s-section>

        {/* Custom React Modal Overlay - Guarantee 100% Opening */}
        {modalOpen && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.55)",
              zIndex: 99999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "20px",
              backdropFilter: "blur(2px)",
            }}
            onClick={closeModal}
          >
            <div
              style={{
                background: "#ffffff",
                borderRadius: "12px",
                maxWidth: "680px",
                width: "100%",
                maxHeight: "90vh",
                overflowY: "auto",
                boxShadow: "0 20px 25px -5px rgba(0,0,0,0.15), 0 10px 10px -5px rgba(0,0,0,0.04)",
                border: "1px solid #e5e7eb",
                display: "flex",
                flexDirection: "column",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div
                style={{
                  padding: "16px 24px",
                  borderBottom: "1px solid #e5e7eb",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "#fafafa",
                  borderTopLeftRadius: "12px",
                  borderTopRightRadius: "12px",
                }}
              >
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#111827" }}>
                  {editingRule ? "✏️ Edit Upsell Rule" : "✨ Create New Upsell Rule"}
                </h2>
                <button
                  type="button"
                  onClick={closeModal}
                  style={{
                    background: "transparent",
                    border: "none",
                    fontSize: "20px",
                    fontWeight: 600,
                    color: "#6b7280",
                    cursor: "pointer",
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Modal Content Body */}
              <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
                
                {/* 1. Rule Name */}
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                    Rule Name <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Turmeric Products Upsell or Cart Booster"
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      borderRadius: "6px",
                      border: "1px solid #d1d5db",
                      fontSize: "14px",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                {/* 2. Target Type Selection */}
                <div>
                  <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "8px" }}>
                    Trigger Condition (Apply To) <span style={{ color: "#dc2626" }}>*</span>
                  </label>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {[
                      { label: "🌐 All Products (Global) - Applies to all items in cart", value: "GLOBAL" },
                      { label: "📁 Collection - Applies when cart contains products from a collection", value: "COLLECTION" },
                      { label: "🏷️ Specific Product - Applies when target product is in cart", value: "PRODUCT" },
                    ].map((option) => (
                      <label
                        key={option.value}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          fontSize: "13px",
                          cursor: "pointer",
                          padding: "10px 12px",
                          borderRadius: "6px",
                          border: ruleType === option.value ? "2px solid #008060" : "1px solid #e5e7eb",
                          background: ruleType === option.value ? "#f0fdf4" : "#ffffff",
                          fontWeight: ruleType === option.value ? 600 : 400,
                        }}
                      >
                        <input
                          type="radio"
                          name="ruleTypeGroup"
                          value={option.value}
                          checked={ruleType === option.value}
                          onChange={() => {
                            setRuleType(option.value as any);
                            setTargetId("");
                            setTargetTitle("");
                            setTargetSearchQuery("");
                            setTargetSearchResults([]);
                          }}
                          style={{ accentColor: "#008060" }}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Target Selection Picker & Search */}
                {(ruleType === "COLLECTION" || ruleType === "PRODUCT") && (
                  <div style={{ background: "#f9fafb", padding: "14px", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
                    <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#4b5563", marginBottom: "8px" }}>
                      Selected Target {ruleType === "COLLECTION" ? "Collection" : "Product"}
                    </label>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
                      <input
                        type="text"
                        readOnly
                        value={targetTitle ? targetTitle : targetId ? targetId : `No ${ruleType.toLowerCase()} selected`}
                        style={{
                          flex: 1,
                          padding: "8px 12px",
                          borderRadius: "6px",
                          border: "1px solid #d1d5db",
                          background: "#f3f4f6",
                          fontSize: "13px",
                          color: targetTitle ? "#111827" : "#9ca3af",
                          fontWeight: targetTitle ? 600 : 400,
                        }}
                      />
                      <button
                        type="button"
                        onClick={selectTargetResource}
                        style={{
                          background: "#008060",
                          color: "#ffffff",
                          border: "none",
                          padding: "8px 14px",
                          borderRadius: "6px",
                          fontSize: "13px",
                          fontWeight: 600,
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Select {ruleType === "COLLECTION" ? "Collection" : "Product"}
                      </button>
                    </div>

                    {/* Target Search Box Fallback */}
                    <div style={{ position: "relative" }}>
                      <input
                        type="text"
                        placeholder={`Or search ${ruleType.toLowerCase()} title...`}
                        value={targetSearchQuery}
                        onChange={(e) => handleTargetSearch(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "7px 10px",
                          borderRadius: "6px",
                          border: "1px solid #d1d5db",
                          fontSize: "13px",
                          boxSizing: "border-box",
                        }}
                      />
                      {targetSearchLoading && <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px" }}>Searching...</div>}
                      {targetSearchResults.length > 0 && (
                        <div
                          style={{
                            position: "absolute",
                            top: "100%",
                            left: 0,
                            right: 0,
                            background: "#ffffff",
                            border: "1px solid #d1d5db",
                            borderRadius: "6px",
                            maxHeight: "180px",
                            overflowY: "auto",
                            zIndex: 10,
                            boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
                            marginTop: "4px",
                          }}
                        >
                          {targetSearchResults.map((item) => (
                            <div
                              key={item.id}
                              onClick={() => selectTargetFromSearch(item)}
                              style={{
                                padding: "8px 12px",
                                borderBottom: "1px solid #f3f4f6",
                                cursor: "pointer",
                                fontSize: "13px",
                                fontWeight: 500,
                                color: "#111827",
                              }}
                            >
                              {item.title}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 3. Priority and Max Products */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                      Priority (Higher = Priority)
                    </label>
                    <input
                      type="number"
                      value={priority}
                      onChange={(e) => setPriority(parseInt(e.target.value) || 0)}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: "1px solid #d1d5db",
                        fontSize: "14px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                      Max Products to Show
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={maxProducts}
                      onChange={(e) => setMaxProducts(parseInt(e.target.value) || 3)}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: "1px solid #d1d5db",
                        fontSize: "14px",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>

                {/* 4. Active Toggle */}
                <div>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: 600, cursor: "pointer", color: "#374151" }}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => setEnabled(e.target.checked)}
                      style={{ width: 16, height: 16, accentColor: "#008060" }}
                    />
                    Enable this rule immediately
                  </label>
                </div>

                {/* 5. Upsell Products Selection */}
                <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div>
                      <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: "#111827" }}>
                        Upsell Products ({selectedProducts.length}) <span style={{ color: "#dc2626" }}>*</span>
                      </h4>
                      <span style={{ fontSize: "12px", color: "#6b7280" }}>
                        Products suggested to customer when rule triggers.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={selectUpsellProductsWithPicker}
                      style={{
                        background: "#008060",
                        color: "#ffffff",
                        border: "none",
                        padding: "8px 14px",
                        borderRadius: "6px",
                        fontSize: "13px",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      + Pick Products
                    </button>
                  </div>

                  {/* Inline Product Search */}
                  <div style={{ position: "relative", marginBottom: "12px" }}>
                    <input
                      type="text"
                      placeholder="Type product title to search and add..."
                      value={searchQuery}
                      onChange={(e) => handleSearch(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "8px 12px",
                        borderRadius: "6px",
                        border: "1px solid #d1d5db",
                        fontSize: "13px",
                        boxSizing: "border-box",
                      }}
                    />
                    {searchLoading && <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "4px" }}>Searching products...</div>}
                    {searchResults.length > 0 && (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          right: 0,
                          background: "#ffffff",
                          border: "1px solid #d1d5db",
                          borderRadius: "6px",
                          maxHeight: "180px",
                          overflowY: "auto",
                          zIndex: 10,
                          boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
                          marginTop: "4px",
                        }}
                      >
                        {searchResults.map((prod) => (
                          <div
                            key={prod.id}
                            onClick={() => addSearchProduct(prod)}
                            style={{
                              padding: "8px 12px",
                              borderBottom: "1px solid #f3f4f6",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                            }}
                          >
                            {prod.image && <img src={prod.image} alt="" style={{ width: 32, height: 32, borderRadius: "4px", objectFit: "cover" }} />}
                            <div>
                              <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>{prod.title}</div>
                              {prod.price && <div style={{ fontSize: "11px", color: "#6b7280" }}>${prod.price}</div>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Selected Products List */}
                  {selectedProducts.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "200px", overflowY: "auto" }}>
                      {selectedProducts.map((prod, idx) => (
                        <div
                          key={prod.productId}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: "8px 12px",
                            background: "#f9fafb",
                            borderRadius: "6px",
                            border: "1px solid #e5e7eb",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <span style={{ fontSize: "12px", fontWeight: 600, color: "#9ca3af" }}>#{idx + 1}</span>
                            {prod.productImage ? (
                              <img src={prod.productImage} alt="" style={{ width: 32, height: 32, borderRadius: "4px", objectFit: "cover" }} />
                            ) : (
                              <div style={{ width: 32, height: 32, background: "#e5e7eb", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px" }}>
                                📦
                              </div>
                            )}
                            <div>
                              <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827" }}>{prod.productTitle}</div>
                              {prod.price && <div style={{ fontSize: "11px", color: "#6b7280" }}>${prod.price}</div>}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeSelectedProduct(prod.productId)}
                            style={{
                              background: "transparent",
                              border: "1px solid #fca5a5",
                              color: "#dc2626",
                              padding: "4px 8px",
                              borderRadius: "4px",
                              fontSize: "12px",
                              cursor: "pointer",
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: "12px", background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: "6px", fontSize: "12px", color: "#8c6b00" }}>
                      ⚠️ No upsell products added yet. Click "+ Pick Products" or type above to search and add products.
                    </div>
                  )}
                </div>

              </div>

              {/* Modal Actions Footer */}
              <div
                style={{
                  padding: "16px 24px",
                  borderTop: "1px solid #e5e7eb",
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "12px",
                  background: "#fafafa",
                  borderBottomLeftRadius: "12px",
                  borderBottomRightRadius: "12px",
                }}
              >
                <button
                  type="button"
                  onClick={closeModal}
                  style={{
                    background: "#ffffff",
                    border: "1px solid #d1d5db",
                    padding: "9px 16px",
                    borderRadius: "6px",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#374151",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveRule}
                  style={{
                    background: "#008060",
                    color: "#ffffff",
                    border: "none",
                    padding: "9px 18px",
                    borderRadius: "6px",
                    fontSize: "14px",
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                  }}
                >
                  {editingRule ? "Save Changes" : "Save Rule"}
                </button>
              </div>

            </div>
          </div>
        )}
      </s-page>
    </AppProvider>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
