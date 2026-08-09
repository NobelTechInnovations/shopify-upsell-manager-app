import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

// Helper headers for CORS so storefront JS can fetch this endpoint seamlessly
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  return loader({ request, params: {}, context: {} } as any);
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const rawProductIds = url.searchParams.get("product_ids") || url.searchParams.get("productIds") || "";
  const rawCollectionIds = url.searchParams.get("collection_ids") || url.searchParams.get("collectionIds") || "";

  if (!shop) {
    return new Response(
      JSON.stringify({ error: "Missing shop parameter", products: [] }),
      { status: 400, headers: corsHeaders }
    );
  }

  const cartProductIds = rawProductIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => (id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`));

  const cartCollectionIds = rawCollectionIds
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => (id.startsWith("gid://") ? id : `gid://shopify/Collection/${id}`));

  try {
    // Fetch active rules for shop ordered by priority DESC, createdAt DESC
    const rules = await prisma.upsellRule.findMany({
      where: {
        shop,
        enabled: true,
      },
      include: {
        products: {
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    });

    if (!rules || rules.length === 0) {
      return new Response(JSON.stringify({ products: [], ruleApplied: null }), {
        headers: corsHeaders,
      });
    }

    // Find best matching rule
    let matchedRule: typeof rules[0] | null = null;

    // 1. Check PRODUCT rules
    if (cartProductIds.length > 0) {
      matchedRule = rules.find((r) => {
        if (r.ruleType !== "PRODUCT" || !r.targetId) return false;
        const targetGid = r.targetId.startsWith("gid://")
          ? r.targetId
          : `gid://shopify/Product/${r.targetId}`;
        return cartProductIds.includes(targetGid);
      }) || null;
    }

    // 2. Check COLLECTION rules if no product rule matched
    if (!matchedRule && cartCollectionIds.length > 0) {
      matchedRule = rules.find((r) => {
        if (r.ruleType !== "COLLECTION" || !r.targetId) return false;
        const targetGid = r.targetId.startsWith("gid://")
          ? r.targetId
          : `gid://shopify/Collection/${r.targetId}`;
        return cartCollectionIds.includes(targetGid);
      }) || null;
    }

    // 3. Fallback to GLOBAL rule if no product/collection rule matched
    if (!matchedRule) {
      matchedRule = rules.find((r) => r.ruleType === "GLOBAL") || null;
    }

    if (!matchedRule || matchedRule.products.length === 0) {
      return new Response(JSON.stringify({ products: [], ruleApplied: null }), {
        headers: corsHeaders,
      });
    }

    // Extract upsell product GIDs, filtering out products already in cart
    const upsellProductGids = matchedRule.products
      .map((p) => (p.productId.startsWith("gid://") ? p.productId : `gid://shopify/Product/${p.productId}`))
      .filter((gid) => !cartProductIds.includes(gid))
      .slice(0, matchedRule.maxProducts);

    if (upsellProductGids.length === 0) {
      return new Response(JSON.stringify({ products: [], ruleApplied: matchedRule.name }), {
        headers: corsHeaders,
      });
    }

    let formattedProducts: any[] = [];

    try {
      const { admin } = await unauthenticated.admin(shop);
      const graphqlQuery = `#graphql
        query getUpsellProducts($ids: [ID!]!) {
          nodes(ids: $ids) {
            ... on Product {
              id
              title
              handle
              featuredImage {
                url
                altText
              }
              variants(first: 1) {
                edges {
                  node {
                    id
                    title
                    price
                    compareAtPrice
                    availableForSale
                  }
                }
              }
            }
          }
        }
      `;

      const res = await admin.graphql(graphqlQuery, { variables: { ids: upsellProductGids } });
      const resJson = await res.json();
      const nodes = resJson.data?.nodes || [];

      formattedProducts = nodes
        .filter((node: any) => node && node.id && node.variants?.edges?.[0]?.node)
        .map((node: any) => {
          const variant = node.variants.edges[0].node;
          const rawVariantId = variant.id;
          const numericVariantId = rawVariantId.replace("gid://shopify/ProductVariant/", "");
          return {
            id: node.id,
            numericProductId: node.id.replace("gid://shopify/Product/", ""),
            title: node.title,
            handle: node.handle,
            image: node.featuredImage?.url || "",
            variantId: variant.id,
            numericVariantId: numericVariantId,
            variantTitle: variant.title,
            price: variant.price,
            compareAtPrice: variant.compareAtPrice,
            availableForSale: variant.availableForSale,
          };
        });
    } catch (gqlErr) {
      console.warn("GraphQL live product query fallback to DB metadata:", gqlErr);
      formattedProducts = matchedRule.products
        .filter((p) => upsellProductGids.includes(p.productId.startsWith("gid://") ? p.productId : `gid://shopify/Product/${p.productId}`))
        .map((p) => {
          const numProdId = p.productId.replace("gid://shopify/Product/", "");
          const numVarId = p.variantId ? p.variantId.replace("gid://shopify/ProductVariant/", "") : "";
          return {
            id: p.productId,
            numericProductId: numProdId,
            title: p.productTitle || "Upsell Product",
            handle: "",
            image: p.productImage || "",
            variantId: p.variantId || "",
            numericVariantId: numVarId,
            price: p.price || "0.00",
            availableForSale: true,
          };
        });
    }

    return new Response(
      JSON.stringify({
        products: formattedProducts,
        ruleApplied: {
          id: matchedRule.id,
          name: matchedRule.name,
          type: matchedRule.ruleType,
        },
      }),
      { headers: corsHeaders }
    );
  } catch (error: any) {
    console.error("Error in api.upsells loader:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to fetch upsells", products: [] }),
      { status: 500, headers: corsHeaders }
    );
  }
};
