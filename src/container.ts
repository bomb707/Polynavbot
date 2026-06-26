import type { Config } from "./config/index.js";
import { createDbClient, createRepositories } from "./db/client.js";
import type { IDbClient, IRepositories } from "./db/types.js";
import { createExecutionService } from "./execution/index.js";
import type { IExecutionService } from "./execution/types.js";
import { createQueueManager } from "./jobs/queue.js";
import { createRedisConnection } from "./jobs/redis.js";
import type { IQueueManager } from "./jobs/queue.js";
import type { IRedisConnection } from "./jobs/types.js";
import { createLogger } from "./logger/index.js";
import type { ILogger } from "./logger/types.js";
import { createPaperTrader } from "./paper/index.js";
import { createPaperTradingEngine } from "./paper/paperTradingEngine.js";
import type { IPaperTrader } from "./paper/types.js";
import type { IPaperTradingEngine } from "./paper/paperTypes.js";
import { createPolymarketClient } from "./polymarket/index.js";
import type { IPolymarketClient } from "./polymarket/types.js";
import { createPublicClient } from "./polymarket/publicClient.js";
import type { IPublicClient } from "./polymarket/publicClient.js";
import { createPositionStore } from "./positions/index.js";
import type { IPositionStore } from "./positions/types.js";
import { createRiskManager } from "./risk/index.js";
import { createRiskEngine } from "./risk/riskEngine.js";
import type { IRiskManager } from "./risk/types.js";
import type { IRiskEngine } from "./risk/riskTypes.js";
import { createMarketScanner } from "./scanner/marketScanner.js";
import type { IMarketScanner } from "./scanner/types.js";
import { createStrategy, createLongshotScorer } from "./strategy/index.js";
import type { IStrategy } from "./strategy/types.js";
import type { ILongshotScorer } from "./strategy/longshotScorer.js";

export class AppContainer {
  private _logger?: ILogger;
  private _db?: IDbClient;
  private _redis?: IRedisConnection;
  private _queueManager?: IQueueManager;
  private _polymarket?: IPolymarketClient;
  private _publicClient?: IPublicClient;
  private _scanner?: IMarketScanner;
  private _strategy?: IStrategy;
  private _riskManager?: IRiskManager;
  private _riskEngine?: IRiskEngine;
  private _execution?: IExecutionService;
  private _paperTrader?: IPaperTrader;
  private _paperTradingEngine?: IPaperTradingEngine;
  private _positionStore?: IPositionStore;
  private _repositories?: IRepositories;
  private _longshotScorer?: ILongshotScorer;

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

  get publicClient(): IPublicClient {
    if (!this._publicClient) {
      this._publicClient = createPublicClient(this.config, this.logger);
    }
    return this._publicClient;
  }

  get scanner(): IMarketScanner {
    if (!this._scanner) {
      this._scanner = createMarketScanner({
        publicClient: this.publicClient,
        repositories: this.repositories,
        config: this.config,
        logger: this.logger,
      });
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

  get riskEngine(): IRiskEngine {
    if (!this._riskEngine) {
      this._riskEngine = createRiskEngine({
        config: this.config,
        repositories: this.repositories,
        logger: this.logger,
      });
    }
    return this._riskEngine;
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

  get paperTradingEngine(): IPaperTradingEngine {
    if (!this._paperTradingEngine) {
      this._paperTradingEngine = createPaperTradingEngine({
        config: this.config,
        repositories: this.repositories,
        logger: this.logger,
        riskEngine: this.riskEngine,
      });
    }
    return this._paperTradingEngine;
  }

  get longshotScorer(): ILongshotScorer {
    if (!this._longshotScorer) {
      this._longshotScorer = createLongshotScorer(this.config);
    }
    return this._longshotScorer;
  }

  get positionStore(): IPositionStore {
    if (!this._positionStore) {
      this._positionStore = createPositionStore(this.logger);
    }
    return this._positionStore;
  }

  get repositories(): IRepositories {
    if (!this._repositories) {
      this._repositories = createRepositories(this.db.prisma);
    }
    return this._repositories;
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
