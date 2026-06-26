import { Redis } from "ioredis";

import type { Config } from "../config/index.js";
import type { IRedisConnection } from "./types.js";
import { ok, err, type Result } from "../utils/result.js";

export function createRedisConnection(config: Config): IRedisConnection {
  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });

  return {
    client,
    async connect() {
      if (client.status === "ready") {
        return;
      }
      await client.connect();
    },
    async disconnect() {
      await client.quit();
    },
  };
}

export async function checkRedisHealth(
  connection: IRedisConnection,
): Promise<Result<{ latencyMs: number }, string>> {
  const start = Date.now();

  try {
    const response = await connection.client.ping();
    if (response !== "PONG") {
      return err(`Unexpected PING response: ${response}`);
    }
    return ok({ latencyMs: Date.now() - start });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Redis error";
    return err(message);
  }
}
