import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Helper to get the tunnel URL from the running dev server
function getAppUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType") as string;

  // Use the store's App Proxy URL — always HTTPS, works in dev and production
  const scriptSrc = `https://${session.shop}/apps/upsell/script`;


  if (actionType === "install") {
    try {
      // Remove existing CartSmart script tags first
      const listRes = await admin.graphql(`#graphql
        query {
          scriptTags(first: 50) {
            edges {
              node {
                id
                src
              }
            }
          }
        }
      `);
      const listJson = await listRes.json();
      const existingTags = listJson.data?.scriptTags?.edges || [];

      for (const edge of existingTags) {
        if (edge.node.src.includes("cart-script") || edge.node.src.includes("cart-smart")) {
          await admin.graphql(`#graphql
            mutation deleteTag($id: ID!) {
              scriptTagDelete(id: $id) {
                deletedScriptTagId
              }
            }
          `, { variables: { id: edge.node.id } });
        }
      }

      // Create new ScriptTag
      const createRes = await admin.graphql(`#graphql
        mutation createScriptTag($input: ScriptTagInput!) {
          scriptTagCreate(input: $input) {
            scriptTag {
              id
              src
            }
            userErrors {
              field
              message
            }
          }
        }
      `, {
        variables: {
          input: {
            src: scriptSrc,
            displayScope: "ONLINE_STORE",
          },
        },
      });

      const createJson = await createRes.json();
      const errors = createJson.data?.scriptTagCreate?.userErrors || [];

      if (errors.length > 0) {
        return new Response(
          JSON.stringify({ success: false, errors }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          scriptTag: createJson.data?.scriptTagCreate?.scriptTag,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ success: false, error: err.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  if (actionType === "uninstall") {
    try {
      const listRes = await admin.graphql(`#graphql
        query {
          scriptTags(first: 50) {
            edges {
              node { id src }
            }
          }
        }
      `);
      const listJson = await listRes.json();
      const tags = listJson.data?.scriptTags?.edges || [];

      let removed = 0;
      for (const edge of tags) {
        if (edge.node.src.includes("cart-script") || edge.node.src.includes("cart-smart")) {
          await admin.graphql(`#graphql
            mutation deleteTag($id: ID!) {
              scriptTagDelete(id: $id) { deletedScriptTagId }
            }
          `, { variables: { id: edge.node.id } });
          removed++;
        }
      }

      return new Response(
        JSON.stringify({ success: true, removed }),
        { headers: { "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ success: false, error: err.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(
    JSON.stringify({ success: false, error: "Unknown action" }),
    { status: 400, headers: { "Content-Type": "application/json" } }
  );
};
