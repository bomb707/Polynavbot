import type { PrismaClient } from "@prisma/client";

import type { IRepositories } from "./repositories/index.js";

export interface IDbClient {
  readonly prisma: PrismaClient;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

export type { IRepositories };
