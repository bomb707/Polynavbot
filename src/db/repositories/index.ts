export {
  createMarketRepository,
  type IMarketRepository,
  type UpsertMarketInput,
} from "./market.repository.js";
export {
  createOutcomeRepository,
  type IOutcomeRepository,
  type UpdateOutcomePricingInput,
  type UpsertOutcomeInput,
} from "./outcome.repository.js";
export {
  createSignalRepository,
  type CreateSignalInput,
  type ISignalRepository,
} from "./signal.repository.js";
export {
  createOrderRepository,
  type CreateLiveOrderInput,
  type CreatePaperOrderInput,
  type IOrderRepository,
} from "./order.repository.js";
export {
  createPositionRepository,
  type ClosePositionInput,
  type CreatePositionInput,
  type IPositionRepository,
  type UpdatePositionInput,
} from "./position.repository.js";
export {
  createRiskEventRepository,
  type CreateRiskEventInput,
  type IRiskEventRepository,
} from "./risk-event.repository.js";

import type { PrismaClient } from "@prisma/client";

import { createMarketRepository, type IMarketRepository } from "./market.repository.js";
import { createOutcomeRepository, type IOutcomeRepository } from "./outcome.repository.js";
import { createOrderRepository, type IOrderRepository } from "./order.repository.js";
import { createPositionRepository, type IPositionRepository } from "./position.repository.js";
import { createRiskEventRepository, type IRiskEventRepository } from "./risk-event.repository.js";
import { createSignalRepository, type ISignalRepository } from "./signal.repository.js";

export interface IRepositories {
  market: IMarketRepository;
  outcome: IOutcomeRepository;
  signal: ISignalRepository;
  order: IOrderRepository;
  position: IPositionRepository;
  riskEvent: IRiskEventRepository;
}

export function createRepositories(prisma: PrismaClient): IRepositories {
  return {
    market: createMarketRepository(prisma),
    outcome: createOutcomeRepository(prisma),
    signal: createSignalRepository(prisma),
    order: createOrderRepository(prisma),
    position: createPositionRepository(prisma),
    riskEvent: createRiskEventRepository(prisma),
  };
}
