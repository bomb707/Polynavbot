export const QUEUE_NAMES = {
  SCAN_MARKETS: "scan-markets",
  EVALUATE_ENTRY: "evaluate-entry",
  UPDATE_POSITIONS: "update-positions",
  EVALUATE_EXITS: "evaluate-exits",
  DAILY_RISK_RESET: "daily-risk-reset",
  PORTFOLIO_REPORT: "portfolio-report",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const ALL_QUEUE_NAMES: QueueName[] = Object.values(QUEUE_NAMES);
