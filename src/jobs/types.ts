import type { Redis } from "ioredis";

export interface IRedisConnection {
  readonly client: Redis;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
