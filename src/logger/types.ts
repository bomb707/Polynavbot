export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface ILogger {
  fatal(obj: Record<string, unknown>, msg?: string): void;
  fatal(msg: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  error(msg: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
  info(obj: Record<string, unknown>, msg?: string): void;
  info(msg: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
  debug(msg: string): void;
  child(bindings: Record<string, unknown>): ILogger;
}
