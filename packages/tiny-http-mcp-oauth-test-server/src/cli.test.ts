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

  it("rejects non-decimal numeric flags", async () => {
    for (const args of [
      ["--port", "0x0", "--print-test-token"],
      ["--ttl-seconds", "1e2", "--print-test-token"],
    ]) {
      let stdout = "";
      let stderr = "";

      const exitCode = await runCli(args, {
        stdout: { write: (chunk) => ((stdout += String(chunk)), true) },
        stderr: { write: (chunk) => ((stderr += String(chunk)), true) },
      });

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain(args[0]);
      expect(stderr).toContain("Usage: tiny-http-mcp-oauth-test-server [options]");
    }
  });

  it("rejects empty comma-separated scope entries", async () => {
    let stdout = "";
    let stderr = "";

    const exitCode = await runCli(["--scopes", "mcp.read,,mcp.write"], {
      stdout: { write: (chunk) => ((stdout += String(chunk)), true) },
      stderr: { write: (chunk) => ((stderr += String(chunk)), true) },
    });

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("--scopes must not contain empty entries.");
  });

  it("returns parser-style errors for server option validation failures", async () => {
    for (const args of [
      ["--mcp-path", "/mcp?tenant=demo"],
      ["--resource", "https://resource.example.com/mcp#fragment"],
      ["--scopes", "mcp.read mcp.write"],
    ]) {
      let stdout = "";
      let stderr = "";

      const exitCode = await runCli(args, {
        stdout: { write: (chunk) => ((stdout += String(chunk)), true) },
        stderr: { write: (chunk) => ((stderr += String(chunk)), true) },
        waitForShutdown: async (shutdown) => shutdown(),
      });

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toContain("Usage: tiny-http-mcp-oauth-test-server [options]");
    }
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
