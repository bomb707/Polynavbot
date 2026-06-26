import type { Market } from "../polymarket/types.js";

export interface ScanResult {
  markets: Market[];
  scannedAt: Date;
}

export interface IScanner {
  scan(): Promise<ScanResult>;
}
