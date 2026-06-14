import { afterEach, describe, expect, it } from "vitest";
import "tiny-http-mcp-server/testing";
import { runCli } from "./cli.js";

describe("tiny-http-mcp-oauth-test-server CLI", () => {
  const cleanups = new Set<() => Promise<void>>();

  afterEach(async () => {
    for (const cleanup of [...cleanups].reverse()) {
      await cleanup();
    }

    cleanups.clear();
  });

  it("starts, prints the documented URLs, and shuts down cleanly", async () => {
    let stdout = "";
    let stderr = "";

    const exitCode = await runCli(["--port", "0", "--hostname", "127.0.0.1", "--print-test-token"], {
      stdout: { write: (chunk) => ((stdout += String(chunk)), true) },
      stderr: { write: (chunk) => ((stderr += String(chunk)), true) },
      waitForShutdown: async (shutdown) => {
        cleanups.add(shutdown);
        await shutdown();
        cleanups.delete(shutdown);
      },
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("MCP URL: http://127.0.0.1:");
    expect(stdout).toContain("PRM URL: http://127.0.0.1:");
    expect(stdout).toContain("AS issuer: http://127.0.0.1:");
    expect(stdout).toContain("Test bearer token: ");
    expect(stderr).toBe("");
  });

  it("does not print a bearer token unless --print-test-token is passed", async () => {
    let stdout = "";
    let stderr = "";

    const exitCode = await runCli([], {
      stdout: { write: (chunk) => ((stdout += String(chunk)), true) },
      stderr: { write: (chunk) => ((stderr += String(chunk)), true) },
      waitForShutdown: async (shutdown) => shutdown(),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("MCP URL: http://127.0.0.1:");
    expect(stdout).toContain("PRM URL: http://127.0.0.1:");
    expect(stdout).toContain("AS issuer: http://127.0.0.1:");
    expect(stdout).not.toContain("Test bearer token: ");
    expect(stderr).toBe("");
  });
});
