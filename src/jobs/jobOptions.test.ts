import { describe, expect, it } from "vitest";

import { sanitizeBullMqJobId } from "./jobOptions.js";

describe("sanitizeBullMqJobId", () => {
  it("replaces colons so BullMQ accepts repeatable-parent ids", () => {
    const raw = "evaluate-entry__repeat:scan-markets-every-10m:1782471600000";
    expect(sanitizeBullMqJobId(raw)).toBe(
      "evaluate-entry__repeat__scan-markets-every-10m__1782471600000",
    );
    expect(sanitizeBullMqJobId(raw)).not.toContain(":");
  });
});
