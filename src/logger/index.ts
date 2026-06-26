import pino, { type Logger as PinoLogger } from "pino";

import type { Config } from "../config/index.js";
import type { ILogger } from "./types.js";

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
