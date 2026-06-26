import type { PaperPosition } from "../paper/types.js";

export interface IPositionStore {
  save(position: PaperPosition): Promise<void>;
  findAll(): Promise<PaperPosition[]>;
  findByMarket(marketId: string): Promise<PaperPosition[]>;
}
