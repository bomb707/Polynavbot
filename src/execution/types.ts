import type { TradeSignal } from "../strategy/types.js";

export interface OrderResult {
  orderId: string;
  status: "simulated";
  signal: TradeSignal;
}

export interface IExecutionService {
  execute(signal: TradeSignal): Promise<OrderResult>;
}
