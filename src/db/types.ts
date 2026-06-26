import type { PrismaClient } from "@prisma/client";

export interface IDbClient {
  readonly prisma: PrismaClient;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
