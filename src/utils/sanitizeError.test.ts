import { describe, expect, it } from "vitest";

import { sanitizeError, sanitizeErrorMessage } from "./sanitizeError.js";

describe("sanitizeError", () => {
  it("redacts credentials from connection URLs", () => {
    const message = sanitizeErrorMessage(
      'connect ECONNREFUSED postgresql://user:secretpass@localhost:5432/db',
    );
    expect(message).not.toContain("secretpass");
    expect(message).toContain("[REDACTED]");
  });

  it("returns message for Error instances", () => {
    expect(sanitizeError(new Error("simple failure"))).toBe("simple failure");
  });
});
