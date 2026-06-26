export interface Market {
  id: string;
  question: string;
  outcome: string;
  price: number;
}

export interface IPolymarketClient {
  getMarkets(): Promise<Market[]>;
}
