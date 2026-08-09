import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const query = url.searchParams.get("query") || "";
  const type = url.searchParams.get("type") || "product";

  if (!query.trim()) {
    return new Response(JSON.stringify({ products: [], collections: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { admin } = await authenticate.admin(request);

    if (type === "collection") {
      const response = await admin.graphql(
        `#graphql
        query searchCollections($query: String!) {
          collections(first: 10, query: $query) {
            edges {
              node {
                id
                title
                handle
                image {
                  url
                  altText
                }
              }
            }
          }
        }`,
        { variables: { query: `title:*${query}*` } }
      );

      const data = await response.json();
      const collections = data.data?.collections?.edges?.map((edge: any) => edge.node) || [];

      return new Response(JSON.stringify({ collections }), {
        headers: { "Content-Type": "application/json" },
      });
    } else {
      const response = await admin.graphql(
        `#graphql
        query searchProducts($query: String!) {
          products(first: 10, query: $query) {
            edges {
              node {
                id
                title
                handle
                featuredImage {
                  url
                  altText
                }
                images(first: 1) {
                  edges {
                    node {
                      url
                      altText
                    }
                  }
                }
                variants(first: 1) {
                  edges {
                    node {
                      id
                      price
                    }
                  }
                }
              }
            }
          }
        }`,
        { variables: { query: `title:*${query}*` } }
      );

      const data = await response.json();
      const products = (data.data?.products?.edges?.map((edge: any) => edge.node) || []).map(
        (prod: any) => ({
          ...prod,
          image: prod.featuredImage?.url || prod.images?.edges?.[0]?.node?.url || "",
          variantId: prod.variants?.edges?.[0]?.node?.id || "",
          price: prod.variants?.edges?.[0]?.node?.price || "0.00",
        })
      );

      return new Response(JSON.stringify({ products }), {
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    console.error("Search error:", error);
    return new Response(JSON.stringify({ products: [], collections: [] }), {
      headers: { "Content-Type": "application/json" },
    });
  }
};