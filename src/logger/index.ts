import pino, { type Logger as PinoLogger } from "pino";

import type { Config } from "../config/index.js";
import type { ILogger } from "./types.js";

const REDACT_PATHS = [
  "PRIVATE_KEY",
  "POLY_API_KEY",
  "POLY_API_SECRET",
  "POLY_API_PASSPHRASE",
  "DATABASE_URL",
  "REDIS_URL",
  "*.PRIVATE_KEY",
  "*.POLY_API_KEY",
  "*.POLY_API_SECRET",
  "*.POLY_API_PASSPHRASE",
  "*.DATABASE_URL",
  "*.REDIS_URL",
  "password",
  "passphrase",
  "secret",
  "apiKey",
  "apiSecret",
];

function wrapPino(logger: PinoLogger): ILogger {
  return {
    fatal: logger.fatal.bind(logger),
    error: logger.error.bind(logger),
    warn: logger.warn.bind(logger),
    info: logger.info.bind(logger),
    debug: logger.debug.bind(logger),
    child: (bindings) => wrapPino(logger.child(bindings)),
  };
}

export function createLogger(config: Config): ILogger {
  const isDevelopment = config.NODE_ENV === "development";

  const logger = pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
    ...(isDevelopment && {
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
        },
      },
    }),
  });

  return wrapPino(logger);
}
