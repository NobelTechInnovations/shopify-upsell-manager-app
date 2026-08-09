import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function getDatabaseUrl(): string | undefined {
  let url = process.env.DATABASE_URL;
  if (url && url.includes("6543") && !url.includes("pgbouncer=true")) {
    url += url.includes("?") ? "&pgbouncer=true" : "?pgbouncer=true";
  }
  return url;
}

function getPrismaClient(): PrismaClient {
  if (!global.prismaGlobal) {
    const dbUrl = getDatabaseUrl();
    global.prismaGlobal = dbUrl
      ? new PrismaClient({ datasources: { db: { url: dbUrl } } })
      : new PrismaClient();
  }
  return global.prismaGlobal;
}

const prisma = getPrismaClient();

export default prisma;
