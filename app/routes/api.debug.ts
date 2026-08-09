import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { PrismaClient } from "@prisma/client";

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
    db_direct: { status: "untested", error: null as any },
    db_pooler: { status: "untested", error: null as any },
  };

  // Test current DATABASE_URL connection
  try {
    await prisma.$connect();
    const sessionCount = await prisma.session.count();
    checks.db_direct = { status: "OK", session_count: sessionCount };
  } catch (e: any) {
    checks.db_direct = { status: "ERROR", error: e.message };
  }

  // Test Supabase pooler connections across regions
  const regions = ["ap-south-1", "us-east-1", "eu-west-1", "ap-southeast-1"];
  const poolerResults: Record<string, any> = {};

  for (const region of regions) {
    const poolerUrl = `postgresql://postgres.uglvjhkoqhftrffcrluy:shopify-upsell-manager@aws-0-${region}.pooler.supabase.com:6543/postgres?connection_limit=1`;
    const client = new PrismaClient({ datasources: { db: { url: poolerUrl } } });
    try {
      await client.$connect();
      await client.$queryRaw`SELECT 1`;
      poolerResults[region] = "OK ✅";
      await client.$disconnect();
    } catch (e: any) {
      poolerResults[region] = `ERROR: ${e.message.split("\n")[0]}`;
    }
  }
  checks.db_pooler = poolerResults;

  return new Response(JSON.stringify(checks, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

