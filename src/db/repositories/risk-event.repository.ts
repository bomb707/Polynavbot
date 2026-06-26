import type {
  Prisma,
  PrismaClient,
  RiskEvent,
  RiskEventType,
  RiskLevel,
} from "@prisma/client";

export interface CreateRiskEventInput {
  level: RiskLevel;
  type: RiskEventType;
  message: string;
  metadata?: Prisma.InputJsonValue;
}

export interface IRiskEventRepository {
  create(data: CreateRiskEventInput): Promise<RiskEvent>;
  findRecent(limit?: number): Promise<RiskEvent[]>;
  findByLevel(level: RiskLevel): Promise<RiskEvent[]>;
}

export function createRiskEventRepository(
  prisma: PrismaClient,
): IRiskEventRepository {
  return {
    create(data) {
      return prisma.riskEvent.create({ data });
    },

    findRecent(limit = 50) {
      return prisma.riskEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
      });
    },

    findByLevel(level) {
      return prisma.riskEvent.findMany({
        where: { level },
        orderBy: { createdAt: "desc" },
      });
    },
  };
}
