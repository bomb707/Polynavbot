import type { IDbClient } from "./types.js";
import { ok, err, type Result } from "../utils/result.js";

export async function checkDbHealth(
  client: IDbClient,
): Promise<Result<{ latencyMs: number }, string>> {
  const start = Date.now();

  try {
    await client.prisma.$queryRaw`SELECT 1`;
    return ok({ latencyMs: Date.now() - start });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown database error";
    return err(message);
  }
}
