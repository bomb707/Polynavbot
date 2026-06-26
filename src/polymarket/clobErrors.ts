import { ApiError } from "@polymarket/clob-client-v2";

export class ClobClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ClobClientError";
  }
}

export class LiveTradingDisabledError extends ClobClientError {
  constructor(message: string) {
    super(message, "LIVE_TRADING_DISABLED");
    this.name = "LiveTradingDisabledError";
  }
}

export class LiveTradingNotConfirmedError extends ClobClientError {
  constructor(message: string) {
    super(message, "LIVE_TRADING_NOT_CONFIRMED");
    this.name = "LiveTradingNotConfirmedError";
  }
}

export class InsufficientBalanceError extends ClobClientError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "INSUFFICIENT_BALANCE", context);
    this.name = "InsufficientBalanceError";
  }
}

export class InsufficientAllowanceError extends ClobClientError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "INSUFFICIENT_ALLOWANCE", context);
    this.name = "InsufficientAllowanceError";
  }
}

export class InvalidSignatureError extends ClobClientError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "INVALID_SIGNATURE", context);
    this.name = "InvalidSignatureError";
  }
}

export class StaleApiCredentialsError extends ClobClientError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "STALE_API_CREDENTIALS", context);
    this.name = "StaleApiCredentialsError";
  }
}

export class RejectedOrderError extends ClobClientError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "REJECTED_ORDER", context);
    this.name = "RejectedOrderError";
  }
}

export class NetworkTimeoutError extends ClobClientError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "NETWORK_TIMEOUT", context);
    this.name = "NetworkTimeoutError";
  }
}

function collectErrorText(error: unknown): string {
  if (error instanceof ApiError) {
    const dataText =
      error.data !== undefined ? JSON.stringify(error.data) : "";
    return `${error.message} ${dataText}`.toLowerCase();
  }
  if (error instanceof Error) {
    return error.message.toLowerCase();
  }
  return String(error).toLowerCase();
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  return (
    name === "aborterror" ||
    name === "timeouterror" ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("network")
  );
}

function isStaleCredentials(text: string, status?: number): boolean {
  if (status === 401 || status === 403) {
    return true;
  }
  return (
    text.includes("l2 auth") ||
    text.includes("invalid api key") ||
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("api key") ||
    text.includes("passphrase")
  );
}

function isInvalidSignature(text: string): boolean {
  return (
    text.includes("invalid signature") ||
    text.includes("signature mismatch") ||
    text.includes("l2 auth not available") ||
    text.includes("wrong private key")
  );
}

function isInsufficientBalance(text: string): boolean {
  return (
    text.includes("insufficient balance") ||
    text.includes("not enough balance") ||
    text.includes("balance too low")
  );
}

function isInsufficientAllowance(text: string): boolean {
  return (
    text.includes("insufficient allowance") ||
    text.includes("allowance") ||
    text.includes("approval") ||
    text.includes("not approved")
  );
}

function isRejectedOrder(text: string): boolean {
  return (
    text.includes("order rejected") ||
    text.includes("not_canceled") ||
    text.includes("rejected") ||
    text.includes("order failed")
  );
}

export function mapClobError(error: unknown): ClobClientError {
  if (error instanceof ClobClientError) {
    return error;
  }

  if (isTimeoutError(error)) {
    const message =
      error instanceof Error ? error.message : "Network request timed out";
    return new NetworkTimeoutError(message);
  }

  const status = error instanceof ApiError ? error.status : undefined;
  const text = collectErrorText(error);
  const baseMessage =
    error instanceof Error ? error.message : "CLOB request failed";
  const context =
    error instanceof ApiError
      ? { status: error.status, data: error.data }
      : undefined;

  if (isInsufficientBalance(text)) {
    return new InsufficientBalanceError(baseMessage, context);
  }
  if (isInsufficientAllowance(text)) {
    return new InsufficientAllowanceError(baseMessage, context);
  }
  if (isInvalidSignature(text)) {
    return new InvalidSignatureError(baseMessage, context);
  }
  if (isStaleCredentials(text, status)) {
    return new StaleApiCredentialsError(baseMessage, context);
  }
  if (isRejectedOrder(text)) {
    return new RejectedOrderError(baseMessage, context);
  }

  if (error instanceof ApiError) {
    return new ClobClientError(baseMessage, "CLOB_API_ERROR", context);
  }

  return new ClobClientError(baseMessage, "UNKNOWN_CLOB_ERROR");
}
