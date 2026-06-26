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

    MAX_DAILY_SPEND_USD: z.coerce.number().positive().default(25),
    MAX_POSITION_SIZE_USD: z.coerce.number().positive().default(2),
    MAX_MARKET_EXPOSURE_USD: z.coerce.number().positive().default(10),
    MAX_THEME_EXPOSURE_USD: z.coerce.number().positive().default(25),
    MIN_ENTRY_PRICE: z.coerce.number().positive().default(0.005),
    MAX_ENTRY_PRICE: z.coerce.number().positive().default(0.04),
    MIN_DAYS_TO_EXPIRY: z.coerce.number().positive().default(30),
    MIN_LIQUIDITY_USD: z.coerce.number().positive().default(1000),
    MAX_SPREAD: z.coerce.number().positive().default(0.03),
    PAPER_STARTING_BALANCE_USD: z.coerce.number().positive().default(500),
    PAPER_PASSIVE_FILL_ON_CROSS: z.coerce.boolean().default(true),

    PRIVATE_KEY: z.string().min(1).optional(),
    DEPOSIT_WALLET_ADDRESS: z.string().min(1).optional(),
    POLY_API_KEY: z.string().min(1).optional(),
    POLY_API_SECRET: z.string().min(1).optional(),
    POLY_API_PASSPHRASE: z.string().min(1).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.MIN_ENTRY_PRICE >= data.MAX_ENTRY_PRICE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MAX_ENTRY_PRICE"],
        message: "MIN_ENTRY_PRICE must be less than MAX_ENTRY_PRICE",
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

export type Env = z.infer<typeof envSchema>;

export function isLiveMode(config: Pick<Env, "TRADING_MODE">): boolean {
  return config.TRADING_MODE === "live";
}

export function isPaperMode(config: Pick<Env, "TRADING_MODE">): boolean {
  return config.TRADING_MODE === "paper";
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

  return result.data;
}
