import { checkDbHealth } from "../db/health.js";
import { checkRedisHealth } from "../jobs/redis.js";
import type { AppContainer } from "../container.js";

export interface HealthCheckResult {
  service: string;
  status: "ok" | "error";
  latencyMs?: number;
  error?: string;
}

export interface HealthReport {
  status: "healthy" | "unhealthy";
  checks: HealthCheckResult[];
  timestamp: string;
}

export async function runHealthCheck(
  container: AppContainer,
): Promise<HealthReport> {
  const checks: HealthCheckResult[] = [];

  await container.db.connect();
  const dbResult = await checkDbHealth(container.db);
  checks.push(
    dbResult.ok
      ? { service: "postgresql", status: "ok", latencyMs: dbResult.value.latencyMs }
      : { service: "postgresql", status: "error", error: dbResult.error },
  );

  await container.redis.connect();
  const redisResult = await checkRedisHealth(container.redis);
  checks.push(
    redisResult.ok
      ? { service: "redis", status: "ok", latencyMs: redisResult.value.latencyMs }
      : { service: "redis", status: "error", error: redisResult.error },
  );

  const allOk = checks.every((c) => c.status === "ok");

  return {
    status: allOk ? "healthy" : "unhealthy",
    checks,
    timestamp: new Date().toISOString(),
  };
}
