import { describe, expect, it, vi, beforeEach } from "vitest";

import type { Config } from "../config/index.js";
import type { IRepositories } from "../db/repositories/index.js";
import type { ILogger } from "../logger/types.js";
import { LiveTradingNotConfirmedError } from "../polymarket/clobErrors.js";
import type { IClobClient } from "../polymarket/clobTypes.js";
import type { IPaperTradingEngine } from "../paper/paperTypes.js";
import type { IRiskEngine } from "../risk/riskTypes.js";
import { createDryRunExecutionEngine } from "./dryRunExecutionEngine.js";
import { createLiveExecutionEngine } from "./liveExecutionEngine.js";
import { createPaperExecutionEngine } from "./paperExecutionEngine.js";
import type { PlaceLimitOrderInput } from "./executionEngineTypes.js";

const baseInput: PlaceLimitOrderInput = {
  marketId: "market-1",
  outcomeId: "outcome-1",
  tokenId: "token-1",
  limitPrice: 0.02,
  sizeUsd: 1.5,
  isNewEntry: true,
  spread: 0.002,
  liquidityUsd: 5000,
};

function createLogger(): ILogger {
  const noop = () => undefined;
  return {
    fatal: noop,
    error: noop,
    warn: noop,
    info: vi.fn(),
    debug: noop,
    child: () => createLogger(),
  };
}

describe("execution engines", () => {
  let riskEngine: IRiskEngine;
  let checkOrder: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    checkOrder = vi.fn().mockResolvedValue({ allowed: true, reason: "Approved" });
    riskEngine = { checkOrder };
  });

  it("paper mode never calls live client", async () => {
    const placeLimitOrder = vi.fn().mockResolvedValue({
      order: {
        id: "paper-order-1",
        status: "PENDING",
      },
    });
    const createLimitBuyOrder = vi.fn();

    const paperTradingEngine = {
      initialize: vi.fn(),
      placeLimitOrder,
    } as unknown as IPaperTradingEngine;

    const clobClient = {
      createLimitBuyOrder,
      createLimitSellOrder: vi.fn(),
    } as unknown as IClobClient;

    const engine = createPaperExecutionEngine({
      repositories: {
        order: {
          findPaperById: vi.fn(),
          updatePaperStatus: vi.fn(),
          findPendingPaperOrders: vi.fn().mockResolvedValue([]),
        },
      } as unknown as IRepositories,
      paperTradingEngine,
      riskEngine,
    });

    await engine.initialize();
    const result = await engine.placeBuyLimitOrder(baseInput);

    expect(result.status).toBe("placed");
    expect(placeLimitOrder).toHaveBeenCalledOnce();
    expect(createLimitBuyOrder).not.toHaveBeenCalled();
  });

  it("dry_run never creates orders", async () => {
    const logger = createLogger();
    const engine = createDryRunExecutionEngine({ riskEngine, logger });

    const result = await engine.placeBuyLimitOrder(baseInput);

    expect(result.status).toBe("logged");
    expect(result.orderId).toBeNull();
    expect(checkOrder).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalled();
  });

  it("live mode fails without confirmation env", async () => {
    const createLimitBuyOrder = vi.fn().mockRejectedValue(
      new LiveTradingNotConfirmedError("confirmation required"),
    );
    const createLiveOrder = vi.fn();

    const engine = createLiveExecutionEngine({
      config: { TRADING_MODE: "live" } as Config,
      repositories: {
        order: { createLiveOrder },
      } as unknown as IRepositories,
      clobClient: {
        initialize: vi.fn(),
        createLimitBuyOrder,
        createLimitSellOrder: vi.fn(),
        getOpenOrders: vi.fn(),
        getTrades: vi.fn(),
        cancelOrder: vi.fn(),
      } as unknown as IClobClient,
      riskEngine,
      logger: createLogger(),
    });

    await expect(engine.placeBuyLimitOrder(baseInput)).rejects.toBeInstanceOf(
      LiveTradingNotConfirmedError,
    );
    expect(createLiveOrder).not.toHaveBeenCalled();
  });

  it("runs risk engine before every order and blocks downstream on rejection", async () => {
    checkOrder.mockResolvedValueOnce({
      allowed: false,
      reason: "Exposure cap exceeded",
    });

    const placeLimitOrder = vi.fn();
    const engine = createPaperExecutionEngine({
      repositories: {
        order: {
          findPendingPaperOrders: vi.fn().mockResolvedValue([]),
        },
      } as unknown as IRepositories,
      paperTradingEngine: {
        initialize: vi.fn(),
        placeLimitOrder,
      } as unknown as IPaperTradingEngine,
      riskEngine,
    });

    const result = await engine.placeBuyLimitOrder(baseInput);

    expect(checkOrder).toHaveBeenCalledOnce();
    expect(placeLimitOrder).not.toHaveBeenCalled();
    expect(result.status).toBe("rejected");
    expect(result.rejectedReason).toBe("Exposure cap exceeded");
  });
});
