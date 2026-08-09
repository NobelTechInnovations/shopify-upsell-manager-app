import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { setAbstractRuntimeString } from "@shopify/shopify-api/runtime";

setAbstractRuntimeString(() => "React Router (Node)");

const appUrl = process.env.SHOPIFY_APP_URL;
const apiKey = process.env.SHOPIFY_API_KEY;
const apiSecretKey = process.env.SHOPIFY_API_SECRET;
const scopes = process.env.SCOPES
  ? process.env.SCOPES.split(",")
  : ["write_script_tags", "read_script_tags", "write_products", "read_products"];

const shopify = shopifyApp({
  apiKey: apiKey!,
  apiSecretKey: apiSecretKey!,
  apiVersion: ApiVersion.July26,
  scopes,
  appUrl: appUrl || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
