import { z, type ZodIssue } from "zod";

export const tradingModeSchema = z.enum(["paper", "dry_run", "live"]);
export type TradingMode = z.infer<typeof tradingModeSchema>;

const LIVE_REQUIRED_FIELDS = [
  "PRIVATE_KEY",
  "DEPOSIT_WALLET_ADDRESS",
  "POLY_API_KEY",
  "POLY_API_SECRET",
  "POLY_API_PASSPHRASE",
] as const;

type LiveRequiredField = (typeof LIVE_REQUIRED_FIELDS)[number];

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),

    POLY_CLOB_HOST: z.string().url(),
    POLY_GAMMA_API_URL: z.string().url(),
    POLY_DATA_API_URL: z.string().url(),
    POLY_WS_MARKET_URL: z.string().url(),
    POLY_WS_USER_URL: z.string().url(),
    POLY_CHAIN_ID: z.coerce.number().int().positive(),

    TRADING_MODE: tradingModeSchema.default("paper"),

    STRATEGY_PROFILE: z.enum(["default", "nyetrisk"]).default("default"),

    MAX_DAILY_SPEND_USD: z.coerce.number().positive().default(25),
    MAX_POSITION_SIZE_USD: z.coerce.number().positive().default(2),
    MAX_MARKET_EXPOSURE_USD: z.coerce.number().positive().default(10),
    MAX_THEME_EXPOSURE_USD: z.coerce.number().positive().default(25),
    MIN_ENTRY_PRICE: z.coerce.number().positive().default(0.005),
    MAX_ENTRY_PRICE: z.coerce.number().positive().default(0.04),
    NO_MIN_ENTRY_PRICE: z.coerce.number().positive().default(0.35),
    NO_MAX_ENTRY_PRICE: z.coerce.number().positive().default(0.65),
    NO_ENTRY_ENABLED: z.coerce.boolean().default(false),
    LONGSHOT_ENTRY_THRESHOLD: z.coerce.number().int().min(0).max(100).default(70),
    TAIL_NO_ENTRY_THRESHOLD: z.coerce.number().int().min(0).max(100).default(60),
    MIN_DAYS_TO_EXPIRY: z.coerce.number().positive().default(30),
    MIN_LIQUIDITY_USD: z.coerce.number().positive().default(1000),
    MAX_SPREAD: z.coerce.number().positive().default(0.03),
    PAPER_STARTING_BALANCE_USD: z.coerce.number().positive().default(500),
    PAPER_PASSIVE_FILL_ON_CROSS: z.coerce.boolean().default(true),

    MAX_OPEN_EXPOSURE_USD: z.coerce.number().positive().default(50),
    MAX_OPEN_POSITIONS: z.coerce.number().int().positive().default(25),
    MAX_OPEN_ORDERS: z.coerce.number().int().positive().default(10),
    MIN_ORDER_SIZE_USD: z.coerce.number().positive().default(0.5),
    MAX_ORDER_SIZE_USD: z.coerce.number().positive().default(2),
    MAX_OUTCOMES_PER_MARKET: z.coerce.number().int().positive().default(2),
    ALLOW_BOTH_SIDES_SAME_MARKET: z.coerce.boolean().default(false),
    MAX_DAILY_LOSS_USD: z.coerce.number().positive().default(10),
    DATA_STALE_SECONDS: z.coerce.number().int().positive().default(300),

    MIRROR_ENABLED: z.coerce.boolean().default(false),
    MIRROR_WALLET: z.string().min(1).optional(),
    MIRROR_MAX_ITEMS: z.coerce.number().int().positive().default(1000),
    SCAN_MAX_PAGES: z.coerce.number().int().positive().default(50),

    EXIT_NEAR_EXPIRY_HOURS: z.coerce.number().positive().default(48),
    EXIT_TRAILING_STOP_PCT: z.coerce.number().positive().max(1).default(0.6),
    EXIT_MIN_LIQUIDITY_USD: z.coerce.number().positive().default(1000),

    JOB_CONCURRENCY: z.coerce.number().int().positive().default(1),
    ENTRY_SIGNAL_DEDUP_MINUTES: z.coerce.number().int().positive().default(10),
    JOB_ATTEMPTS: z.coerce.number().int().positive().default(3),
    JOB_BACKOFF_MS: z.coerce.number().int().positive().default(5000),

    BACKTEST_INTERVAL: z.string().default("1h"),
    BACKTEST_SLIPPAGE_BPS: z.coerce.number().int().nonnegative().default(50),
    BACKTEST_FILL_PROBABILITY: z.coerce.number().positive().max(1).default(0.7),
    BACKTEST_ASSUMED_SPREAD: z.coerce.number().positive().default(0.02),
    BACKTEST_TOP_OF_BOOK_DEPTH_USD: z.coerce.number().positive().default(25),
    BACKTEST_MIN_LIQUIDITY_FOR_EXIT: z.coerce.number().positive().default(1000),
    BACKTEST_STARTING_CAPITAL_USD: z.coerce.number().positive().default(500),
    BACKTEST_SEED: z.coerce.number().int().default(42),
    BACKTEST_MAX_MARKETS: z.coerce.number().int().positive().default(100),

    LIVE_TRADING_CONFIRMATION: z.string().min(1).optional(),
    POLY_SIGNATURE_TYPE: z.coerce.number().int().min(0).max(3).default(3),

    PRIVATE_KEY: z.string().min(1).optional(),
    DEPOSIT_WALLET_ADDRESS: z.string().min(1).optional(),
    POLY_API_KEY: z.string().min(1).optional(),
    POLY_API_SECRET: z.string().min(1).optional(),
    POLY_API_PASSPHRASE: z.string().min(1).optional(),

    WS_ENABLED: z.coerce.boolean().default(false),
    WS_PING_INTERVAL_MS: z.coerce.number().int().positive().default(10000),
    WS_RECONNECT_BASE_MS: z.coerce.number().int().positive().default(1000),
    WS_RECONNECT_MAX_MS: z.coerce.number().int().positive().default(30000),
    WS_SNAPSHOT_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
    WS_EXIT_DEBOUNCE_MS: z.coerce.number().int().positive().default(2000),
    WS_SUBSCRIPTION_REFRESH_MS: z.coerce.number().int().positive().default(60000),
    WS_REST_RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(120),

    BUILDER_FEE_BPS: z.coerce.number().int().nonnegative().default(0),
    FEE_PARAMS_REFRESH_HOURS: z.coerce.number().positive().default(24),
    BACKTEST_FEE_MODE: z
      .enum(["maker_only", "taker_only", "mixed", "actual_if_available"])
      .default("mixed"),
  })
  .superRefine((data, ctx) => {
    if (data.MIN_ENTRY_PRICE >= data.MAX_ENTRY_PRICE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MAX_ENTRY_PRICE"],
        message: "MIN_ENTRY_PRICE must be less than MAX_ENTRY_PRICE",
      });
    }

    if (data.NO_MIN_ENTRY_PRICE >= data.NO_MAX_ENTRY_PRICE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["NO_MAX_ENTRY_PRICE"],
        message: "NO_MIN_ENTRY_PRICE must be less than NO_MAX_ENTRY_PRICE",
      });
    }

    if (data.TRADING_MODE !== "live") {
      return;
    }

    for (const field of LIVE_REQUIRED_FIELDS) {
      if (!data[field]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required when TRADING_MODE=live`,
        });
      }
    }
  });

import { applyStrategyProfile } from "./strategyProfile.js";

export type Env = z.infer<typeof envSchema>;

export function isLiveMode(config: Pick<Env, "TRADING_MODE">): boolean {
  return config.TRADING_MODE === "live";
}

export function isPaperMode(config: Pick<Env, "TRADING_MODE">): boolean {
  return config.TRADING_MODE === "paper";
}

export function isDryRunMode(config: Pick<Env, "TRADING_MODE">): boolean {
  return config.TRADING_MODE === "dry_run";
}

function issueGroup(path: string): string {
  if (path === "TRADING_MODE" || LIVE_REQUIRED_FIELDS.includes(path as LiveRequiredField)) {
    return "Trading mode";
  }
  if (path.startsWith("POLY_")) {
    return "Polymarket API";
  }
  if (
    path === "DATABASE_URL" ||
    path === "REDIS_URL" ||
    path === "NODE_ENV" ||
    path === "LOG_LEVEL"
  ) {
    return "Application";
  }
  return "Strategy";
}

function formatValidationErrors(issues: ZodIssue[]): string {
  const grouped = new Map<string, string[]>();

  for (const issue of issues) {
    const path = issue.path.join(".") || "unknown";
    const group = issueGroup(path);
    const line = `  - ${path}: ${issue.message}`;
    const lines = grouped.get(group) ?? [];
    lines.push(line);
    grouped.set(group, lines);
  }

  const sections = [...grouped.entries()]
    .map(([group, lines]) => `[${group}]\n${lines.join("\n")}`)
    .join("\n\n");

  return `Environment validation failed:\n\n${sections}\n\nFix the above variables in your .env file (see .env.example).`;
}

export function parseEnv(
  raw: Record<string, string | undefined> = process.env,
): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    throw new Error(formatValidationErrors(result.error.issues));
  }

  return applyStrategyProfile(result.data);
}
