import "../vitest.setup.js";
import { describe, expect, it } from "vitest";
import { createExpressOAuthHandlers } from "./express-middleware.js";
import { createTestMcpServer } from "./testing.js";

describe("configured HTTP MCP paths", () => {
  it("rejects query-bearing listener paths", async () => {
    await expect(createTestMcpServer().listenHttp({ path: "/mcp?tenant=demo" })).rejects.toThrow(
      "path must not include a query or fragment"
    );
  });

  it("rejects query-bearing Express OAuth paths", () => {
    expect(() =>
      createExpressOAuthHandlers({
        path: "/mcp?tenant=demo",
        server: createTestMcpServer(),
        oauth: {
          resource: "https://resource.example/mcp",
          authorizationServers: ["https://issuer.example"],
          verifier: {
            async verify() {
              throw new Error("unused");
            }
          }
        }
      })
    ).toThrow("path must not include a query or fragment");
  });
});
