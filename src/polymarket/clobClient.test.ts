import { ApiError } from "@polymarket/clob-client-v2";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { ILogger } from "../logger/types.js";
import { createClobClient, type ClobClientConfig } from "./clobClient.js";
import {
  InsufficientAllowanceError,
  InsufficientBalanceError,
  InvalidSignatureError,
  LiveTradingDisabledError,
  LiveTradingNotConfirmedError,
  NetworkTimeoutError,
  StaleApiCredentialsError,
  mapClobError,
} from "./clobErrors.js";

const mockCreateAndPostOrder = vi.fn();
const mockGetOpenOrders = vi.fn();
const mockGetTrades = vi.fn();
const mockCancelOrder = vi.fn();
const mockCancelAll = vi.fn();
const mockCreateOrDeriveApiKey = vi.fn();
const mockGetBalanceAllowance = vi.fn();
const mockGetTickSize = vi.fn();
const mockGetNegRisk = vi.fn();

vi.mock("@polymarket/clob-client-v2", async () => {
  const actual = await vi.importActual<typeof import("@polymarket/clob-client-v2")>(
    "@polymarket/clob-client-v2",
  );
  return {
    ...actual,
    ClobClient: vi.fn().mockImplementation(() => ({
      createOrDeriveApiKey: mockCreateOrDeriveApiKey,
      getBalanceAllowance: mockGetBalanceAllowance,
      getOpenOrders: mockGetOpenOrders,
      getTrades: mockGetTrades,
      createAndPostOrder: mockCreateAndPostOrder,
      cancelOrder: mockCancelOrder,
      cancelAll: mockCancelAll,
      getTickSize: mockGetTickSize,
      getNegRisk: mockGetNegRisk,
      signer: {},
      funderAddress: "0x0000000000000000000000000000000000000001",
    })),
  };
});

function createLogger(): ILogger {
  const noop = () => undefined;
  return {
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    child: () => createLogger(),
  };
}

const baseLiveConfig: ClobClientConfig = {
  TRADING_MODE: "live",
  LIVE_TRADING_CONFIRMATION: "I_UNDERSTAND_THE_RISKS",
  POLY_CLOB_HOST: "https://clob.polymarket.com",
  POLY_CHAIN_ID: 137,
  POLY_SIGNATURE_TYPE: 3,
  PRIVATE_KEY:
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  DEPOSIT_WALLET_ADDRESS: "0x0000000000000000000000000000000000000001",
  POLY_API_KEY: "test-key",
  POLY_API_SECRET: "test-secret",
  POLY_API_PASSPHRASE: "test-passphrase",
};

describe("createClobClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateOrDeriveApiKey.mockResolvedValue({
      key: "derived-key",
      secret: "derived-secret",
      passphrase: "derived-passphrase",
    });
    mockGetBalanceAllowance.mockResolvedValue({});
    mockGetOpenOrders.mockResolvedValue([
      {
        id: "order-1",
        status: "LIVE",
        owner: "owner",
        maker_address: "0xmaker",
        market: "0xmarket",
        asset_id: "token-1",
        side: "BUY",
        original_size: "10",
        size_matched: "0",
        price: "0.02",
        associate_trades: [],
        outcome: "Yes",
        created_at: 1_700_000_000,
        expiration: "0",
        order_type: "GTC",
      },
    ]);
    mockGetTrades.mockResolvedValue([]);
    mockCancelOrder.mockResolvedValue({ canceled: ["order-1"], not_canceled: {} });
    mockCancelAll.mockResolvedValue({ canceled: ["order-1"], not_canceled: {} });
    mockGetTickSize.mockResolvedValue("0.01");
    mockGetNegRisk.mockResolvedValue(false);
    mockCreateAndPostOrder.mockResolvedValue({
      success: true,
      errorMsg: "",
      orderID: "placed-order",
      status: "LIVE",
      takingAmount: "0",
      makingAmount: "0",
    });
  });

  it("throws LiveTradingDisabledError in paper mode for all methods", async () => {
    const client = createClobClient(
      { ...baseLiveConfig, TRADING_MODE: "paper" },
      createLogger(),
    );

    await expect(client.getOpenOrders()).rejects.toBeInstanceOf(
      LiveTradingDisabledError,
    );
    await expect(client.getTrades()).rejects.toBeInstanceOf(
      LiveTradingDisabledError,
    );
    await expect(
      client.createLimitBuyOrder({ tokenId: "t", price: 0.01, size: 1 }),
    ).rejects.toBeInstanceOf(LiveTradingDisabledError);
    await expect(
      client.createLimitSellOrder({ tokenId: "t", price: 0.01, size: 1 }),
    ).rejects.toBeInstanceOf(LiveTradingDisabledError);
    await expect(client.cancelOrder("order-1")).rejects.toBeInstanceOf(
      LiveTradingDisabledError,
    );
    await expect(client.cancelAllOrders()).rejects.toBeInstanceOf(
      LiveTradingDisabledError,
    );
  });

  it("allows read/cancel in live mode without confirmation phrase", async () => {
    const client = createClobClient(
      { ...baseLiveConfig, LIVE_TRADING_CONFIRMATION: undefined },
      createLogger(),
    );

    const orders = await client.getOpenOrders();
    expect(orders).toHaveLength(1);
    expect(orders[0]?.orderId).toBe("order-1");

    await expect(client.cancelOrder("order-1")).resolves.toEqual({
      canceled: ["order-1"],
      notCanceled: {},
    });
  });

  it("requires confirmation phrase for order placement", async () => {
    const client = createClobClient(
      { ...baseLiveConfig, LIVE_TRADING_CONFIRMATION: undefined },
      createLogger(),
    );

    await expect(
      client.createLimitBuyOrder({ tokenId: "token-1", price: 0.02, size: 5 }),
    ).rejects.toBeInstanceOf(LiveTradingNotConfirmedError);
    expect(mockCreateAndPostOrder).not.toHaveBeenCalled();
  });

  it("places limit buy when live mode and confirmation are set", async () => {
    const client = createClobClient(baseLiveConfig, createLogger());

    const result = await client.createLimitBuyOrder({
      tokenId: "token-1",
      price: 0.02,
      size: 5,
    });

    expect(result.orderId).toBe("placed-order");
    expect(mockCreateAndPostOrder).toHaveBeenCalledOnce();
  });

  it("fails initialization with invalid funder address", async () => {
    const client = createClobClient(
      {
        ...baseLiveConfig,
        DEPOSIT_WALLET_ADDRESS: "not-an-address",
      },
      createLogger(),
    );

    await expect(client.initialize()).rejects.toThrow(/Invalid DEPOSIT_WALLET_ADDRESS/);
  });
});

describe("mapClobError", () => {
  it("maps balance errors", () => {
    const error = mapClobError(
      new ApiError("Insufficient balance for order", 400, {}),
    );
    expect(error).toBeInstanceOf(InsufficientBalanceError);
  });

  it("maps allowance errors", () => {
    const error = mapClobError(
      new ApiError("Insufficient allowance for token", 400, {}),
    );
    expect(error).toBeInstanceOf(InsufficientAllowanceError);
  });

  it("maps signature errors", () => {
    const error = mapClobError(
      new ApiError("Invalid signature for L2 auth", 401, {}),
    );
    expect(error).toBeInstanceOf(InvalidSignatureError);
  });

  it("maps stale credential errors", () => {
    const error = mapClobError(new ApiError("Unauthorized", 401, {}));
    expect(error).toBeInstanceOf(StaleApiCredentialsError);
  });

  it("maps network timeout errors", () => {
    const error = mapClobError(new DOMException("Aborted", "AbortError"));
    expect(error).toBeInstanceOf(NetworkTimeoutError);
  });
});
