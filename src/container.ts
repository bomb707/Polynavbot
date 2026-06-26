import type { Config } from "./config/index.js";
import { createDbClient, createRepositories } from "./db/client.js";
import type { IDbClient, IRepositories } from "./db/types.js";
import { createExecutionService } from "./execution/index.js";
import type { IExecutionService } from "./execution/types.js";
import { createEntryEngine } from "./execution/entryEngine.js";
import type { IEntryEngine } from "./execution/entryTypes.js";
import { createExitEngine } from "./execution/exitEngine.js";
import type { IExitEngine } from "./execution/exitTypes.js";
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
import { createClobClient } from "./polymarket/clobClient.js";
import type { IClobClient } from "./polymarket/clobTypes.js";
import { createPublicClient } from "./polymarket/publicClient.js";
import type { IPublicClient } from "./polymarket/publicClient.js";
import { createPriceCache } from "./polymarket/priceCache.js";
import type { IPriceCache } from "./polymarket/priceCache.js";
import { createWsClient } from "./polymarket/wsClient.js";
import type { IWsClient, IWsMonitorService } from "./polymarket/wsTypes.js";
import { createWsMonitorService } from "./polymarket/wsMonitorService.js";
import { createExecutionEngine } from "./execution/createExecutionEngine.js";
import type { IExecutionEngine } from "./execution/executionEngineTypes.js";
import { createPositionMonitor } from "./positions/positionMonitor.js";
import type { IPositionMonitor } from "./positions/positionMonitorTypes.js";
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
import { createFeeService } from "./fees/index.js";
import type { IFeeService } from "./fees/feeTypes.js";
import { stopWorkers } from "./jobs/worker.js";

export class AppContainer {
  private _logger?: ILogger;
  private _db?: IDbClient;
  private _redis?: IRedisConnection;
  private _queueManager?: IQueueManager;
  private _polymarket?: IPolymarketClient;
  private _publicClient?: IPublicClient;
  private _clobClient?: IClobClient;
  private _executionEngine?: IExecutionEngine;
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
  private _entryEngine?: IEntryEngine;
  private _exitEngine?: IExitEngine;
  private _positionMonitor?: IPositionMonitor;
  private _priceCache?: IPriceCache;
  private _wsClient?: IWsClient;
  private _wsMonitorService?: IWsMonitorService;
  private _feeService?: IFeeService;

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

  get clobClient(): IClobClient {
    if (!this._clobClient) {
      this._clobClient = createClobClient(this.config, this.logger);
    }
    return this._clobClient;
  }

  get executionEngine(): IExecutionEngine {
    if (!this._executionEngine) {
      this._executionEngine = createExecutionEngine({
        config: this.config,
        repositories: this.repositories,
        logger: this.logger,
        riskEngine: this.riskEngine,
        paperTradingEngine: this.paperTradingEngine,
        clobClient: this.clobClient,
      });
    }
    return this._executionEngine;
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

  get feeService(): IFeeService {
    if (!this._feeService) {
      this._feeService = createFeeService(this.config);
    }
    return this._feeService;
  }

  get paperTradingEngine(): IPaperTradingEngine {
    if (!this._paperTradingEngine) {
      this._paperTradingEngine = createPaperTradingEngine({
        config: this.config,
        repositories: this.repositories,
        logger: this.logger,
        riskEngine: this.riskEngine,
        feeService: this.feeService,
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

  get entryEngine(): IEntryEngine {
    if (!this._entryEngine) {
      this._entryEngine = createEntryEngine({
        config: this.config,
        scanner: this.scanner,
        scorer: this.longshotScorer,
        riskEngine: this.riskEngine,
        executionEngine: this.executionEngine,
        publicClient: this.publicClient,
        repositories: this.repositories,
        paperTradingEngine: this.paperTradingEngine,
        feeService: this.feeService,
        logger: this.logger,
      });
    }
    return this._entryEngine;
  }

  get exitEngine(): IExitEngine {
    if (!this._exitEngine) {
      this._exitEngine = createExitEngine({
        config: this.config,
        repositories: this.repositories,
        publicClient: this.publicClient,
        executionEngine: this.executionEngine,
        paperTradingEngine: this.paperTradingEngine,
        riskEngine: this.riskEngine,
        feeService: this.feeService,
        logger: this.logger,
      });
    }
    return this._exitEngine;
  }

  get positionMonitor(): IPositionMonitor {
    if (!this._positionMonitor) {
      this._positionMonitor = createPositionMonitor({
        config: this.config,
        repositories: this.repositories,
        publicClient: this.publicClient,
        paperTradingEngine: this.paperTradingEngine,
        exitEngine: this.exitEngine,
        logger: this.logger,
      });
    }
    return this._positionMonitor;
  }

  get priceCache(): IPriceCache {
    if (!this._priceCache) {
      this._priceCache = createPriceCache();
    }
    return this._priceCache;
  }

  get wsClient(): IWsClient {
    if (!this._wsClient) {
      this._wsClient = createWsClient(this.config, this.logger);
    }
    return this._wsClient;
  }

  get wsMonitorService(): IWsMonitorService {
    if (!this._wsMonitorService) {
      this._wsMonitorService = createWsMonitorService({
        config: this.config,
        logger: this.logger,
        repositories: this.repositories,
        wsClient: this.wsClient,
        priceCache: this.priceCache,
        publicClient: this.publicClient,
        exitEngine: this.exitEngine,
        paperTradingEngine: this.paperTradingEngine,
      });
    }
    return this._wsMonitorService;
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
    await stopWorkers();

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
