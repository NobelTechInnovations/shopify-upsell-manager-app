import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

// On Vercel, serverless filesystem is read-only. Redirect SQLite to /tmp directory
function prepareDatabaseUrl() {
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes("dev.sqlite")) {
      const tmpPath = "/tmp/dev.sqlite";
      try {
        if (!fs.existsSync(tmpPath)) {
          const rootDb = path.join(process.cwd(), "prisma", "dev.sqlite");
          if (fs.existsSync(rootDb)) {
            fs.copyFileSync(rootDb, tmpPath);
          } else {
            fs.writeFileSync(tmpPath, "");
          }
        }
      } catch (e) {
        console.warn("Unable to copy sqlite to /tmp:", e);
      }
      process.env.DATABASE_URL = "file:/tmp/dev.sqlite";
    }
  }
}

prepareDatabaseUrl();

function getPrismaClient(): PrismaClient {
  if (!global.prismaGlobal || !(global.prismaGlobal as any).cartSettings) {
    global.prismaGlobal = new PrismaClient();
  }
  return global.prismaGlobal;
}

const prisma = getPrismaClient();

export default prisma;



