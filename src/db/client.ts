import { PrismaClient } from "@prisma/client";

import type { Config } from "../config/index.js";
import { createRepositories } from "./repositories/index.js";
import type { IRepositories } from "./repositories/index.js";
import type { IDbClient } from "./types.js";

export function createDbClient(config: Config): IDbClient {
  const prisma = new PrismaClient({
    datasources: {
      db: { url: config.DATABASE_URL },
    },
  });

  return {
    prisma,
    async connect() {
      await prisma.$connect();
    },
    async disconnect() {
      await prisma.$disconnect();
    },
  };
}

export { createRepositories };
export type { IRepositories };
