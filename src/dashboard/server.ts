import { createServer, type Server } from "node:http";

import type { ILogger } from "../logger/types.js";
import type { ReportSnapshot } from "../report/reportTypes.js";
import { renderDashboardPage } from "./renderHtml.js";

export interface DashboardServerOptions {
  port: number;
  refreshSeconds: number;
  buildSnapshot: () => Promise<ReportSnapshot>;
  logger: ILogger;
}

export function createDashboardServer(options: DashboardServerOptions): Server {
  const { port, refreshSeconds, buildSnapshot, logger } = options;
  const pageHtml = renderDashboardPage({ refreshSeconds });

  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url ?? "/", `http://127.0.0.1:${port}`).pathname;

    if (req.method === "GET" && pathname === "/api/snapshot") {
      try {
        const snapshot = await buildSnapshot();
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(snapshot));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ err: message }, "Dashboard snapshot failed");
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    if (req.method === "GET" && pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(pageHtml);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  return server;
}

export function startDashboardServer(options: DashboardServerOptions): Promise<Server> {
  const server = createDashboardServer(options);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject);
      options.logger.info(
        { port: options.port, refreshSeconds: options.refreshSeconds },
        "Dashboard listening",
      );
      resolve(server);
    });
  });
}
