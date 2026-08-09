import type { LoaderFunctionArgs } from "react-router";
import { loader as cartScriptLoader } from "./api.cart-script";

// App proxy script route: accessible from storefront via /apps/upsell/script
export const loader = async (args: LoaderFunctionArgs) => {
  return cartScriptLoader(args);
};
