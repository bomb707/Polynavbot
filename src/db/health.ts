import type { IDbClient } from "./types.js";
import { ok, err, type Result } from "../utils/result.js";
import { sanitizeError } from "../utils/sanitizeError.js";

export async function checkDbHealth(
  client: IDbClient,
): Promise<Result<{ latencyMs: number }, string>> {
  const start = Date.now();

  try {
    await client.prisma.$queryRaw`SELECT 1`;
    return ok({ latencyMs: Date.now() - start });
  } catch (error) {
    return err(sanitizeError(error));
  }
}
