import { describe, expect, it } from "vitest";

import type { ActivityItem } from "../polymarket/publicTypes.js";
import { collectWalletTokenCandidates } from "./walletMirror.js";

describe("collectWalletTokenCandidates", () => {
  it("dedupes trade assets and skips non-trade rows", () => {
    const activity: ActivityItem[] = [
      {
        type: "TRADE",
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        asset: "token-1",
        side: "BUY",
        size: 10,
        price: 0.02,
        slug: "market-a",
        title: "Will A win?",
        conditionId: "cond-a",
        outcomeName: "Yes",
        raw: {},
      },
      {
        type: "TRADE",
        timestamp: new Date("2026-01-02T00:00:00.000Z"),
        asset: "token-1",
        side: "SELL",
        size: 5,
        price: 0.03,
        slug: "market-a",
        title: "Will A win?",
        conditionId: "cond-a",
        outcomeName: "Yes",
        raw: {},
      },
      {
        type: "REDEEM",
        timestamp: new Date("2026-01-03T00:00:00.000Z"),
        asset: "token-2",
        side: null,
        size: null,
        price: null,
        slug: "market-b",
        title: "Will B win?",
        conditionId: "cond-b",
        outcomeName: "Yes",
        raw: {},
      },
    ];

    const candidates = collectWalletTokenCandidates(activity);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.tokenId).toBe("token-1");
    expect(candidates[0]?.slug).toBe("market-a");
  });

  it("collects both YES and NO token candidates", () => {
    const activity: ActivityItem[] = [
      {
        type: "TRADE",
        timestamp: new Date("2026-01-01T00:00:00.000Z"),
        asset: "token-yes",
        side: "BUY",
        size: 10,
        price: 0.02,
        slug: "market-a",
        title: "Will A win?",
        conditionId: "cond-a",
        outcomeName: "Yes",
        raw: {},
      },
      {
        type: "TRADE",
        timestamp: new Date("2026-01-02T00:00:00.000Z"),
        asset: "token-no",
        side: "BUY",
        size: 10,
        price: 0.5,
        slug: "market-b",
        title: "Will B win?",
        conditionId: "cond-b",
        outcomeName: "No",
        raw: {},
      },
    ];

    const candidates = collectWalletTokenCandidates(activity);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.tokenId).sort()).toEqual(["token-no", "token-yes"]);
  });
});
