import {
  ClobClient,
  OrderType,
  Side,
  SignatureTypeV2,
  type ApiKeyCreds,
  type OpenOrder,
  type OpenOrderParams,
  type OrderResponse,
  type TickSize,
  type Trade,
  type TradeParams,
} from "@polymarket/clob-client-v2";
import { createWalletClient, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

import type { Config } from "../config/index.js";
import {
  assertLiveOrderPlacementAllowed,
  assertLiveTradingEnabled,
} from "../config/liveTradingGuards.js";
import type { ILogger } from "../logger/types.js";
import { sanitizeError } from "../utils/sanitizeError.js";
import {
  mapClobError,
  RejectedOrderError,
  StaleApiCredentialsError,
} from "./clobErrors.js";
import type {
  CancelOrderResult,
  IClobClient,
  LimitOrderParams,
  LimitOrderType,
  NormalizedOpenOrder,
  NormalizedTrade,
  OpenOrderQuery,
  OrderPlacementResult,
  TradeQuery,
} from "./clobTypes.js";

export type ClobClientConfig = Pick<
  Config,
  | "TRADING_MODE"
  | "LIVE_TRADING_CONFIRMATION"
  | "POLY_CLOB_HOST"
  | "POLY_CHAIN_ID"
  | "POLY_SIGNATURE_TYPE"
  | "PRIVATE_KEY"
  | "DEPOSIT_WALLET_ADDRESS"
  | "POLY_API_KEY"
  | "POLY_API_SECRET"
  | "POLY_API_PASSPHRASE"
>;

function normalizePrivateKey(privateKey: string): `0x${string}` {
  const trimmed = privateKey.trim();
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

function toOrderType(orderType: LimitOrderType = "GTC"): OrderType.GTC | OrderType.GTD {
  return orderType === "GTD" ? OrderType.GTD : OrderType.GTC;
}

function toOpenOrderParams(params?: OpenOrderQuery): OpenOrderParams | undefined {
  if (!params) {
    return undefined;
  }
  return {
    id: params.id,
    market: params.market,
    asset_id: params.assetId,
  };
}

function toTradeParams(params?: TradeQuery): TradeParams | undefined {
  if (!params) {
    return undefined;
  }
  return {
    id: params.id,
    maker_address: params.makerAddress,
    market: params.market,
    asset_id: params.assetId,
    before: params.before,
    after: params.after,
  };
}

function parseNumber(value: string): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeOpenOrder(order: OpenOrder): NormalizedOpenOrder {
  return {
    orderId: order.id,
    status: order.status,
    tokenId: order.asset_id,
    market: order.market,
    side: order.side,
    price: parseNumber(order.price),
    originalSize: parseNumber(order.original_size),
    sizeMatched: parseNumber(order.size_matched),
    outcome: order.outcome,
    createdAt: new Date(order.created_at * 1000),
    orderType: order.order_type,
  };
}

function normalizeTrade(trade: Trade): NormalizedTrade {
  const matchTime = trade.match_time
    ? new Date(Number(trade.match_time) * 1000)
    : null;

  return {
    tradeId: trade.id,
    tokenId: trade.asset_id,
    market: trade.market,
    side: trade.side,
    price: parseNumber(trade.price),
    size: parseNumber(trade.size),
    status: trade.status,
    outcome: trade.outcome,
    matchTime:
      matchTime && !Number.isNaN(matchTime.getTime()) ? matchTime : null,
    traderSide: trade.trader_side,
  };
}

function normalizeOrderResponse(response: OrderResponse): OrderPlacementResult {
  return {
    success: response.success,
    orderId: response.orderID,
    status: response.status,
    errorMessage: response.errorMsg || null,
    takingAmount: response.takingAmount,
    makingAmount: response.makingAmount,
  };
}

function normalizeCancelResponse(payload: unknown): CancelOrderResult {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const canceled = Array.isArray(record.canceled)
      ? record.canceled.map(String)
      : [];
    const notCanceled =
      record.not_canceled && typeof record.not_canceled === "object"
        ? Object.fromEntries(
            Object.entries(record.not_canceled as Record<string, unknown>).map(
              ([key, value]) => [key, String(value)],
            ),
          )
        : {};
    return { canceled, notCanceled };
  }
  return { canceled: [], notCanceled: {} };
}

function hasEnvApiCredentials(
  config: ClobClientConfig,
): config is ClobClientConfig & {
  POLY_API_KEY: string;
  POLY_API_SECRET: string;
  POLY_API_PASSPHRASE: string;
} {
  return Boolean(
    config.POLY_API_KEY &&
      config.POLY_API_SECRET &&
      config.POLY_API_PASSPHRASE,
  );
}

function toSignatureType(value: number): SignatureTypeV2 {
  switch (value) {
    case SignatureTypeV2.EOA:
      return SignatureTypeV2.EOA;
    case SignatureTypeV2.POLY_PROXY:
      return SignatureTypeV2.POLY_PROXY;
    case SignatureTypeV2.POLY_GNOSIS_SAFE:
      return SignatureTypeV2.POLY_GNOSIS_SAFE;
    case SignatureTypeV2.POLY_1271:
    default:
      return SignatureTypeV2.POLY_1271;
  }
}

export function createClobClient(
  config: ClobClientConfig,
  logger: ILogger,
): IClobClient {
  let sdk: ClobClient | null = null;
  let credsFromEnv = false;
  let walletClient: ReturnType<typeof createWalletClient> | null = null;
  let funderAddress: `0x${string}` | null = null;

  const buildSdk = (
    signer: ReturnType<typeof createWalletClient>,
    creds: ApiKeyCreds,
    funder: `0x${string}`,
  ): ClobClient => {
    return new ClobClient({
      host: config.POLY_CLOB_HOST,
      chain: config.POLY_CHAIN_ID,
      signer,
      creds,
      signatureType: toSignatureType(config.POLY_SIGNATURE_TYPE),
      funderAddress: funder,
      throwOnError: true,
      retryOnError: true,
    });
  };

  const resolveCredentials = async (
    walletClient: ReturnType<typeof createWalletClient>,
  ): Promise<ApiKeyCreds> => {
    if (hasEnvApiCredentials(config)) {
      credsFromEnv = true;
      return {
        key: config.POLY_API_KEY,
        secret: config.POLY_API_SECRET,
        passphrase: config.POLY_API_PASSPHRASE,
      };
    }

    const l1Client = new ClobClient({
      host: config.POLY_CLOB_HOST,
      chain: config.POLY_CHAIN_ID,
      signer: walletClient,
      throwOnError: true,
      retryOnError: true,
    });

    const derived = await l1Client.createOrDeriveApiKey();
    logger.info(
      "Derived Polymarket API credentials — persist POLY_API_KEY, POLY_API_SECRET, and POLY_API_PASSPHRASE in .env",
    );
    return derived;
  };

  const refreshCredentials = async (): Promise<void> => {
    if (!walletClient || !funderAddress) {
      throw new StaleApiCredentialsError(
        "Cannot refresh API credentials before client initialization",
      );
    }

    const l1Client = new ClobClient({
      host: config.POLY_CLOB_HOST,
      chain: config.POLY_CHAIN_ID,
      signer: walletClient,
      throwOnError: true,
      retryOnError: true,
    });

    const creds = await l1Client.createOrDeriveApiKey();
    sdk = buildSdk(walletClient, creds, funderAddress);
    logger.warn("Refreshed Polymarket API credentials after auth failure");
  };

  const ensureInitialized = async (): Promise<ClobClient> => {
    assertLiveTradingEnabled(config);

    if (sdk) {
      return sdk;
    }

    if (!config.PRIVATE_KEY) {
      throw mapClobError(new Error("PRIVATE_KEY is required for live trading"));
    }
    if (!config.DEPOSIT_WALLET_ADDRESS) {
      throw mapClobError(
        new Error("DEPOSIT_WALLET_ADDRESS is required for live trading"),
      );
    }
    if (!isAddress(config.DEPOSIT_WALLET_ADDRESS)) {
      throw mapClobError(
        new Error(
          `Invalid DEPOSIT_WALLET_ADDRESS: ${config.DEPOSIT_WALLET_ADDRESS}`,
        ),
      );
    }

    const normalizedFunder = getAddress(config.DEPOSIT_WALLET_ADDRESS);
    funderAddress = normalizedFunder;
    const account = privateKeyToAccount(normalizePrivateKey(config.PRIVATE_KEY));
    walletClient = createWalletClient({
      account,
      chain: polygon,
      transport: http(),
    });

    logger.info(
      {
        signerAddress: account.address,
        funderAddress: normalizedFunder,
        signatureType: config.POLY_SIGNATURE_TYPE,
        credsSource: hasEnvApiCredentials(config) ? "env" : "derive",
      },
      "Initializing Polymarket CLOB client",
    );

    const creds = await resolveCredentials(walletClient);
    sdk = buildSdk(walletClient, creds, normalizedFunder);

    try {
      await sdk.getBalanceAllowance();
    } catch (error) {
      logger.warn(
        { err: sanitizeError(error) },
        "Balance/allowance check failed during CLOB init (non-fatal)",
      );
    }

    return sdk;
  };

  const withMappedError = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      throw mapClobError(error);
    }
  };

  const withStaleCredentialRetry = async <T>(
    fn: () => Promise<T>,
    allowRetry: boolean,
  ): Promise<T> => {
    try {
      return await withMappedError(fn);
    } catch (error) {
      if (
        allowRetry &&
        !credsFromEnv &&
        error instanceof StaleApiCredentialsError
      ) {
        await refreshCredentials();
        return withMappedError(fn);
      }
      throw error;
    }
  };

  const resolveOrderOptions = async (
    client: ClobClient,
    params: LimitOrderParams,
  ): Promise<{ tickSize: TickSize; negRisk: boolean }> => {
    const tickSize =
      (params.tickSize as TickSize | undefined) ??
      ((await client.getTickSize(params.tokenId)) as TickSize);
    const negRisk =
      params.negRisk ?? (await client.getNegRisk(params.tokenId));
    return { tickSize, negRisk };
  };

  const placeLimitOrder = async (
    params: LimitOrderParams,
    side: Side,
  ): Promise<OrderPlacementResult> => {
    assertLiveOrderPlacementAllowed(config);
    const client = await ensureInitialized();
    const orderType = toOrderType(params.orderType);
    const options = await resolveOrderOptions(client, params);

    const response = await withStaleCredentialRetry(
      () =>
        client.createAndPostOrder(
          {
            tokenID: params.tokenId,
            price: params.price,
            size: params.size,
            side,
          },
          options,
          orderType,
        ),
      true,
    );

    const result = normalizeOrderResponse(response);
    if (!result.success) {
      throw new RejectedOrderError(
        result.errorMessage ?? "Order rejected by CLOB",
        { orderId: result.orderId, status: result.status },
      );
    }

    return result;
  };

  return {
    async initialize(): Promise<void> {
      await ensureInitialized();
    },

    async getOpenOrders(params?: OpenOrderQuery): Promise<NormalizedOpenOrder[]> {
      const client = await ensureInitialized();
      const orders = await withStaleCredentialRetry(
        () => client.getOpenOrders(toOpenOrderParams(params), true),
        false,
      );
      return orders.map(normalizeOpenOrder);
    },

    async getTrades(params?: TradeQuery): Promise<NormalizedTrade[]> {
      const client = await ensureInitialized();
      const trades = await withStaleCredentialRetry(
        () => client.getTrades(toTradeParams(params), true),
        false,
      );
      return trades.map(normalizeTrade);
    },

    async createLimitBuyOrder(
      params: LimitOrderParams,
    ): Promise<OrderPlacementResult> {
      return placeLimitOrder(params, Side.BUY);
    },

    async createLimitSellOrder(
      params: LimitOrderParams,
    ): Promise<OrderPlacementResult> {
      return placeLimitOrder(params, Side.SELL);
    },

    async cancelOrder(orderId: string): Promise<CancelOrderResult> {
      assertLiveTradingEnabled(config);
      const client = await ensureInitialized();
      const response = await withStaleCredentialRetry(
        () => client.cancelOrder({ orderID: orderId }),
        false,
      );
      return normalizeCancelResponse(response);
    },

    async cancelAllOrders(): Promise<CancelOrderResult> {
      assertLiveTradingEnabled(config);
      const client = await ensureInitialized();
      const response = await withStaleCredentialRetry(
        () => client.cancelAll(),
        false,
      );
      return normalizeCancelResponse(response);
    },
  };
}
