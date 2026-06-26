import { describe, expect, it } from "vitest";

import { escapeHtmlForTest, renderDashboardPage } from "./renderHtml.js";

describe("renderDashboardPage", () => {
  it("includes refresh interval and api path", () => {
    const html = renderDashboardPage({ refreshSeconds: 15 });
    expect(html).toContain("REFRESH_MS = 15000");
    expect(html).toContain('fetch("/api/snapshot")');
    expect(html).toContain("Polynavbot Dashboard");
  });
});

describe("escapeHtmlForTest", () => {
  it("escapes html special characters", () => {
    expect(escapeHtmlForTest('<script>"&"</script>')).toBe(
      "&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;",
    );
  });
});
