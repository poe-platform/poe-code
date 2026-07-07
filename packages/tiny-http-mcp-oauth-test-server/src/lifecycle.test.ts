import { beforeEach, describe, expect, it, vi } from "vitest";

const { mcpClose, mcpListenHttp, oauthClose } = vi.hoisted(() => ({
  mcpClose: vi.fn(),
  mcpListenHttp: vi.fn(),
  oauthClose: vi.fn()
}));

vi.mock("../../mcp-oauth/dist/index.js", () => ({
  createJwksTokenVerifier: vi.fn(() => ({ verify: vi.fn() }))
}));
vi.mock("tiny-http-mcp-server", () => ({
  TokenVerificationError: class TokenVerificationError extends Error {}
}));
vi.mock("tiny-http-mcp-server/test-support", () => ({
  nodeFetch: vi.fn(),
  createTestMcpServer: vi.fn(() => ({ listenHttp: mcpListenHttp }))
}));
vi.mock("tiny-oauth-test-server", () => ({
  createOAuthTestServer: vi.fn(() => ({
    issuer: "http://127.0.0.1:4010/oauth",
    listen: vi.fn().mockResolvedValue({ close: oauthClose })
  }))
}));

import { createMcpOAuthTestServer } from "./index.js";

describe("createMcpOAuthTestServer lifecycle errors", () => {
  beforeEach(() => {
    mcpClose.mockReset();
    mcpListenHttp.mockReset();
    oauthClose.mockReset();
  });

  it("reports failed rollback when startup cannot clean up OAuth", async () => {
    mcpListenHttp.mockRejectedValueOnce(new Error("mcp listener failed"));
    oauthClose.mockRejectedValueOnce(new Error("oauth rollback failed"));

    await expect(
      createMcpOAuthTestServer({
        issuer: "http://127.0.0.1:4010/oauth",
        resource: "http://127.0.0.1:4020/mcp"
      }).listen({ hostname: "127.0.0.1", port: 4020 })
    ).rejects.toThrow("oauth rollback failed");

    expect(oauthClose).toHaveBeenCalledTimes(1);
  });

  it("retries an underlying listener close after an initial shutdown failure", async () => {
    mcpListenHttp.mockResolvedValueOnce({
      close: mcpClose,
      url: "http://127.0.0.1:4020/mcp"
    });
    mcpClose.mockRejectedValueOnce(new Error("mcp close failed")).mockResolvedValueOnce(undefined);
    oauthClose.mockResolvedValue(undefined);
    const handle = await createMcpOAuthTestServer({
      issuer: "http://127.0.0.1:4010/oauth",
      resource: "http://127.0.0.1:4020/mcp"
    }).listen({ hostname: "127.0.0.1", port: 4020 });

    await expect(handle.close()).rejects.toThrow("mcp close failed");
    await expect(handle.close()).resolves.toBeUndefined();
    expect(mcpClose).toHaveBeenCalledTimes(2);
  });
});
