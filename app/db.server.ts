import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient | undefined;
}

function getPrismaClient(): PrismaClient {
  if (!global.prismaGlobal || !(global.prismaGlobal as any).cartSettings) {
    global.prismaGlobal = new PrismaClient();
  }
  return global.prismaGlobal;
}

const prisma = getPrismaClient();

export default prisma;


