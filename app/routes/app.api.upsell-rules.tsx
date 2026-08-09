import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  const rules = await prisma.upsellRule.findMany({
    where: { 
      shop: session.shop,
      enabled: true 
    },
    include: { 
      products: { 
        orderBy: { sortOrder: "asc" } 
      } 
    },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });

  return new Response(JSON.stringify({ upsellRules: rules }), { 
    headers: { "Content-Type": "application/json" } 
  });
};