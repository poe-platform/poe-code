import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "./cli.js";

describe("tiny-http-mcp-oauth-test-server CLI", () => {
  const require = createRequire(import.meta.url);
  const cliSourcePath = fileURLToPath(new URL("./cli.ts", import.meta.url));
  const tsxCliPath = require.resolve("tsx/cli");
  const activeChildren = new Set<ChildProcessWithoutNullStreams>();

  function waitForStartup(
    child: ChildProcessWithoutNullStreams,
    options: Partial<{
      requireToken: boolean;
    }> = {}
  ): Promise<{
    stdout(): string;
    stderr(): string;
  }> {
    const requireToken = options.requireToken ?? false;

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";

      const cleanup = () => {
        child.stdout.off("data", onStdout);
        child.stderr.off("data", onStderr);
        child.off("exit", onExit);
        child.off("error", onError);
      };

      const onStdout = (chunk: Buffer) => {
        stdout += chunk.toString("utf8");
        if (
          stdout.includes("MCP URL: ")
          && stdout.includes("PRM URL: ")
          && stdout.includes("AS issuer: ")
          && (!requireToken || stdout.includes("Test bearer token: "))
        ) {
          cleanup();
          resolve({
            stdout: () => stdout,
            stderr: () => stderr,
          });
        }
      };

      const onStderr = (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(
          new Error(
            `CLI exited before startup completed (code=${String(code)}, signal=${String(signal)}): ${stderr}`
          )
        );
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      child.stdout.on("data", onStdout);
      child.stderr.on("data", onStderr);
      child.once("exit", onExit);
      child.once("error", onError);
    });
  }

  function waitForExit(
    child: ChildProcessWithoutNullStreams
  ): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve, reject) => {
      child.once("exit", (code, signal) => {
        resolve({ code, signal });
      });
      child.once("error", reject);
    });
  }

  afterEach(() => {
    for (const child of activeChildren) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    }

    activeChildren.clear();
  });

  it("starts, prints the documented URLs, and exits cleanly on SIGTERM", async () => {
    const env = { ...process.env };
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;

    const child = spawn(
      process.execPath,
      [
        tsxCliPath,
        cliSourcePath,
        "--port",
        "0",
        "--hostname",
        "127.0.0.1",
        "--print-test-token",
      ],
      {
        cwd: fileURLToPath(new URL("../../..", import.meta.url)),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    activeChildren.add(child);

    const started = await waitForStartup(child, { requireToken: true });
    const exitPromise = waitForExit(child);

    expect(started.stdout()).toContain("MCP URL: http://127.0.0.1:");
    expect(started.stdout()).toContain("PRM URL: http://127.0.0.1:");
    expect(started.stdout()).toContain("AS issuer: http://127.0.0.1:");
    expect(started.stdout()).toContain("Test bearer token: ");

    child.kill("SIGTERM");

    const result = await exitPromise;
    activeChildren.delete(child);

    expect(result.signal).toBeNull();
    expect([0, 143]).toContain(result.code);
    expect(started.stderr()).toBe("");
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
