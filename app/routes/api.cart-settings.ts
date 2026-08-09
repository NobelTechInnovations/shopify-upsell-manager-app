import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
  "Cache-Control": "public, max-age=60",
};

const defaultSettings = {
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return new Response(
      JSON.stringify({ settings: defaultSettings }),
      { headers: corsHeaders }
    );
  }

  try {
    const settings = await prisma.cartSettings.findUnique({ where: { shop } });
    return new Response(
      JSON.stringify({ settings: settings || defaultSettings }),
      { headers: corsHeaders }
    );
  } catch {
    return new Response(
      JSON.stringify({ settings: defaultSettings }),
      { headers: corsHeaders }
    );
  }
};

export const action = loader as any;
