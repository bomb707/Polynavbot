import type { Config } from "./config/index.js";
import { createDbClient } from "./db/client.js";
import type { IDbClient } from "./db/types.js";
import { createExecutionService } from "./execution/index.js";
import type { IExecutionService } from "./execution/types.js";
import { createQueueManager } from "./jobs/queue.js";
import { createRedisConnection } from "./jobs/redis.js";
import type { IQueueManager } from "./jobs/queue.js";
import type { IRedisConnection } from "./jobs/types.js";
import { createLogger } from "./logger/index.js";
import type { ILogger } from "./logger/types.js";
import { createPaperTrader } from "./paper/index.js";
import type { IPaperTrader } from "./paper/types.js";
import { createPolymarketClient } from "./polymarket/index.js";
import type { IPolymarketClient } from "./polymarket/types.js";
import { createPositionStore } from "./positions/index.js";
import type { IPositionStore } from "./positions/types.js";
import { createRiskManager } from "./risk/index.js";
import type { IRiskManager } from "./risk/types.js";
import { createScanner } from "./scanner/index.js";
import type { IScanner } from "./scanner/types.js";
import { createStrategy } from "./strategy/index.js";
import type { IStrategy } from "./strategy/types.js";

export class AppContainer {
  private _logger?: ILogger;
  private _db?: IDbClient;
  private _redis?: IRedisConnection;
  private _queueManager?: IQueueManager;
  private _polymarket?: IPolymarketClient;
  private _scanner?: IScanner;
  private _strategy?: IStrategy;
  private _riskManager?: IRiskManager;
  private _execution?: IExecutionService;
  private _paperTrader?: IPaperTrader;
  private _positionStore?: IPositionStore;

  constructor(readonly config: Config) {}

  get logger(): ILogger {
    if (!this._logger) {
      this._logger = createLogger(this.config);
    }
    return this._logger;
  }

  get db(): IDbClient {
    if (!this._db) {
      this._db = createDbClient(this.config);
    }
    return this._db;
  }

  get redis(): IRedisConnection {
    if (!this._redis) {
      this._redis = createRedisConnection(this.config);
    }
    return this._redis;
  }

  get queueManager(): IQueueManager {
    if (!this._queueManager) {
      this._queueManager = createQueueManager(this.config, this.logger);
    }
    return this._queueManager;
  }

  get polymarket(): IPolymarketClient {
    if (!this._polymarket) {
      this._polymarket = createPolymarketClient(this.logger);
    }
    return this._polymarket;
  }

  get scanner(): IScanner {
    if (!this._scanner) {
      this._scanner = createScanner(this.polymarket, this.logger);
    }
    return this._scanner;
  }

  get strategy(): IStrategy {
    if (!this._strategy) {
      this._strategy = createStrategy(this.logger);
    }
    return this._strategy;
  }

  get riskManager(): IRiskManager {
    if (!this._riskManager) {
      this._riskManager = createRiskManager(this.logger);
    }
    return this._riskManager;
  }

  get execution(): IExecutionService {
    if (!this._execution) {
      this._execution = createExecutionService(this.logger);
    }
    return this._execution;
  }

  get paperTrader(): IPaperTrader {
    if (!this._paperTrader) {
      this._paperTrader = createPaperTrader(this.logger);
    }
    return this._paperTrader;
  }

  get positionStore(): IPositionStore {
    if (!this._positionStore) {
      this._positionStore = createPositionStore(this.logger);
    }
    return this._positionStore;
  }

  async shutdown(): Promise<void> {
    const tasks: Promise<void>[] = [];

    if (this._queueManager) {
      tasks.push(this._queueManager.closeAll());
    }
    if (this._redis) {
      tasks.push(this._redis.disconnect());
    }
    if (this._db) {
      tasks.push(this._db.disconnect());
    }

    await Promise.all(tasks);
  }
}

export function createContainer(config: Config): AppContainer {
  return new AppContainer(config);
}
