#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "node:http";
import { createMcpServer, setBrowserRenderUrl, setBrowserRenderApiKey } from "./server.js";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, mcp-session-id, Authorization",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

function startHttpServer(port: number) {
  const httpServer = createServer(async (req, res) => {
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, value);
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({ status: "ok", name: "mcp-hemnet", version: "2.0.0" })
      );
      return;
    }

    if (req.url === "/mcp" && req.method === "POST") {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      await server.connect(transport);

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString());

      await transport.handleRequest(req, res, body);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  httpServer.listen(port, () => {
    console.error(`mcp-hemnet HTTP server listening on port ${port}`);
    console.error(`MCP endpoint: http://localhost:${port}/mcp`);
    console.error(`Health check: http://localhost:${port}/health`);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const httpMode = args.includes("--http");
  const port = parseInt(
    args.find((a) => a.startsWith("--port="))?.split("=")[1] ||
      process.env.PORT ||
      "3001",
    10
  );

  // Configure browser render service
  if (process.env.BROWSER_RENDER_URL) {
    setBrowserRenderUrl(process.env.BROWSER_RENDER_URL);
  }
  if (process.env.BROWSER_RENDER_API_KEY) {
    setBrowserRenderApiKey(process.env.BROWSER_RENDER_API_KEY);
  }

  if (httpMode) {
    startHttpServer(port);
  } else {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
