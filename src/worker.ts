import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer, setBrowserRenderUrl, setBrowserRenderApiKey } from "./server.js";

type Bindings = {
  BROWSER_RENDER_URL: string;
  BROWSER_RENDER_API_KEY?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, mcp-session-id, Authorization",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

app.options("/mcp", (c) => {
  return c.newResponse(null, { headers: CORS_HEADERS });
});

app.post("/mcp", async (c) => {
  if (c.env.BROWSER_RENDER_URL) {
    setBrowserRenderUrl(c.env.BROWSER_RENDER_URL);
  }
  if (c.env.BROWSER_RENDER_API_KEY) {
    setBrowserRenderApiKey(c.env.BROWSER_RENDER_API_KEY);
  }

  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });

  await server.connect(transport);
  const response = await transport.handleRequest(c.req.raw);

  // Add CORS headers
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});

app.get("/health", (c) => {
  return c.json({ status: "ok", name: "mcp-hemnet", version: "2.0.0" });
});

export default app;
