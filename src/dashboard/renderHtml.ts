export interface DashboardPageOptions {
  refreshSeconds: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderDashboardPage(options: DashboardPageOptions): string {
  const refreshMs = options.refreshSeconds * 1000;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Polynavbot Dashboard</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0f1419;
      --panel: #1a2332;
      --border: #2d3a4f;
      --text: #e7ecf3;
      --muted: #8b9cb3;
      --green: #3dd68c;
      --red: #f87171;
      --accent: #60a5fa;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 1;
    }
    h1 { margin: 0; font-size: 1.25rem; }
    .meta { color: var(--muted); font-size: 0.875rem; }
    main { padding: 1.5rem; max-width: 1400px; margin: 0 auto; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 1rem;
    }
    .card .label { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
    .card .value { font-size: 1.35rem; font-weight: 600; margin-top: 0.25rem; }
    section { margin-bottom: 1.5rem; }
    section h2 {
      margin: 0 0 0.75rem;
      font-size: 1rem;
      color: var(--muted);
      font-weight: 600;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      font-size: 0.875rem;
    }
    th, td {
      padding: 0.65rem 0.75rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 600; background: #151d29; }
    tr:last-child td { border-bottom: none; }
    .pnl-pos { color: var(--green); }
    .pnl-neg { color: var(--red); }
    .badge {
      display: inline-block;
      padding: 0.1rem 0.45rem;
      border-radius: 999px;
      font-size: 0.75rem;
      background: #243044;
      color: var(--accent);
    }
    .empty { color: var(--muted); padding: 1rem; background: var(--panel); border-radius: 10px; border: 1px solid var(--border); }
    .error {
      margin: 1rem 1.5rem;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      background: #3f1d1d;
      border: 1px solid #7f1d1d;
      color: #fecaca;
      display: none;
    }
    .status-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--green);
      margin-right: 0.35rem;
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Polynavbot Dashboard</h1>
      <div class="meta"><span class="status-dot" id="status-dot"></span><span id="status-text">Loading…</span></div>
    </div>
    <div class="meta" id="mode-badge"></div>
  </header>
  <div class="error" id="error"></div>
  <main id="app"></main>
  <script>
    const REFRESH_MS = ${refreshMs};

    function fmtUsd(v) {
      if (v == null || Number.isNaN(v)) return "N/A";
      const sign = v < 0 ? "-" : "";
      return sign + "$" + Math.abs(v).toFixed(2);
    }

    function fmtPct(v) {
      if (v == null) return "N/A";
      return (v * 100).toFixed(2) + "%";
    }

    function pnlClass(v) {
      if (v > 0) return "pnl-pos";
      if (v < 0) return "pnl-neg";
      return "";
    }

    function esc(s) {
      return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function truncate(s, n) {
      s = String(s);
      return s.length <= n ? s : s.slice(0, n - 1) + "…";
    }

    function renderTable(headers, rows) {
      if (!rows.length) return '<div class="empty">(none)</div>';
      const head = "<tr>" + headers.map((h) => "<th>" + esc(h) + "</th>").join("") + "</tr>";
      const body = rows.map((row) => "<tr>" + row.map((cell) => "<td>" + cell + "</td>").join("") + "</tr>").join("");
      return "<table><thead>" + head + "</thead><tbody>" + body + "</tbody></table>";
    }

    function render(snapshot) {
      const p = snapshot.portfolio;
      document.getElementById("mode-badge").innerHTML = '<span class="badge">' + esc(p.mode.toUpperCase()) + "</span>";
      document.getElementById("status-text").textContent =
        "Updated " + new Date(p.generatedAt).toLocaleString() + " · refresh every ${options.refreshSeconds}s";

      const cards = [
        ["Cash", fmtUsd(p.cashBalanceUsd)],
        ["Portfolio", fmtUsd(p.portfolioValueUsd)],
        ["Total PnL", fmtUsd(p.totalPnlUsd)],
        ["Realized", fmtUsd(p.realizedPnlUsd)],
        ["Unrealized", fmtUsd(p.unrealizedPnlUsd)],
        ["Open positions", String(p.openPositionsCount)],
        ["Open orders", String(p.openOrdersCount)],
        ["Fees paid", fmtUsd(p.totalFeesPaidUsd)],
        ["Fees % gross", fmtPct(p.feesAsPercentOfGrossPnl)],
      ];

      const cardHtml = cards.map(([label, value]) =>
        '<div class="card"><div class="label">' + esc(label) + '</div><div class="value">' + esc(value) + "</div></div>"
      ).join("");

      const positions = [...snapshot.topWinners, ...snapshot.topLosers.filter(
        (l) => !snapshot.topWinners.some((w) => w.tokenId === l.tokenId)
      )];
      const positionRows = positions.map((row) => [
        esc(truncate(row.question, 60)),
        '<span class="' + pnlClass(row.unrealizedPnlUsd) + '">' + esc(fmtUsd(row.unrealizedPnlUsd)) + "</span>",
        esc(row.currentPrice.toFixed(4)),
        esc(fmtUsd(row.costBasisUsd)),
      ]);

      const signalRows = snapshot.recentSignals.map((s) => [
        esc(s.createdAt.slice(0, 19).replace("T", " ")),
        esc(s.status),
        esc(s.signalType),
        esc(s.score.toFixed(2)),
        esc(s.entryPrice.toFixed(4)),
        esc(truncate(s.reason, 50)),
      ]);

      const tradeRows = snapshot.trades.slice(-20).reverse().map((t) => [
        esc(t.timestamp.slice(0, 19).replace("T", " ")),
        esc(t.side),
        esc(truncate(t.question, 40)),
        esc(t.price.toFixed(4)),
        esc(fmtUsd(t.notionalUsd)),
        esc(fmtUsd(t.totalFeeUsd)),
        esc(t.liquidityRole),
      ]);

      const exitRows = snapshot.pendingExits.map((e) => [
        esc(truncate(e.question, 50)),
        esc(e.action),
        esc(e.reason),
        esc(e.sellSizeShares.toFixed(4)),
        esc(e.sellPrice.toFixed(4)),
      ]);

      const riskRows = snapshot.riskRejections.map((r) => [
        esc(r.createdAt.slice(0, 19).replace("T", " ")),
        esc(r.level),
        esc(r.type),
        esc(truncate(r.message, 60)),
      ]);

      document.getElementById("app").innerHTML =
        '<div class="grid">' + cardHtml + "</div>" +
        '<section><h2>Open Positions</h2>' + renderTable(["Market", "uPnL", "Price", "Cost"], positionRows) + "</section>" +
        '<section><h2>Recent Signals</h2>' + renderTable(["Time", "Status", "Type", "Score", "Entry", "Reason"], signalRows) + "</section>" +
        '<section><h2>Recent Trades</h2>' + renderTable(["Time", "Side", "Market", "Price", "Notional", "Fee", "Role"], tradeRows) + "</section>" +
        '<section><h2>Pending Exits</h2>' + renderTable(["Market", "Action", "Reason", "Size", "Price"], exitRows) + "</section>" +
        '<section><h2>Risk Rejections</h2>' + renderTable(["Time", "Level", "Type", "Message"], riskRows) + "</section>";
    }

    async function refresh() {
      const errorEl = document.getElementById("error");
      try {
        const res = await fetch("/api/snapshot");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const snapshot = await res.json();
        render(snapshot);
        errorEl.style.display = "none";
        document.getElementById("status-dot").style.background = "var(--green)";
      } catch (err) {
        errorEl.textContent = "Failed to load snapshot: " + err.message;
        errorEl.style.display = "block";
        document.getElementById("status-dot").style.background = "var(--red)";
        document.getElementById("status-text").textContent = "Connection error";
      }
    }

    refresh();
    setInterval(refresh, REFRESH_MS);
  </script>
</body>
</html>`;
}

export function escapeHtmlForTest(value: string): string {
  return escapeHtml(value);
}
