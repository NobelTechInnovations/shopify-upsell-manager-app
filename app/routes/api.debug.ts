import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

// Debug endpoint — hit https://upsell-manager.vercel.app/api/debug to diagnose
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const checks: Record<string, any> = {
    timestamp: new Date().toISOString(),
    node_env: process.env.NODE_ENV,
    env_vars: {
      SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY ? `set (${process.env.SHOPIFY_API_KEY})` : "MISSING",
      SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET ? `set (length=${process.env.SHOPIFY_API_SECRET.length})` : "MISSING",
      SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL || "MISSING",
      DATABASE_URL: process.env.DATABASE_URL
        ? `set (${process.env.DATABASE_URL.replace(/:[^:@]+@/, ":***@")})`
        : "MISSING",
      SCOPES: process.env.SCOPES || "MISSING",
    },
    db: { status: "untested", error: null as any },
  };

  // Test DB connection
  try {
    await prisma.$connect();
    const sessionCount = await prisma.session.count();
    checks.db = { status: "OK", session_count: sessionCount };
  } catch (e: any) {
    checks.db = { status: "ERROR", error: e.message };
  }

  return new Response(JSON.stringify(checks, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
