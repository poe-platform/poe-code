import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { runCli } from "./cli.js";

const require = createRequire(import.meta.url);
const cliSourcePath = fileURLToPath(new URL("./cli.ts", import.meta.url));
const tsxCliPath = require.resolve("tsx/cli");
const activeChildren = new Set<ChildProcessWithoutNullStreams>();
const initializeRequest = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: {
      name: "tiny-http-cli-test",
      version: "1.0.0",
    },
  },
};

interface CapturedOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly io: {
    stdout: { write: (chunk: string | Uint8Array) => boolean };
    stderr: { write: (chunk: string | Uint8Array) => boolean };
  };
}

function createCapturedOutput(): CapturedOutput {
  let stdout = "";
  let stderr = "";

  const append = (chunk: string | Uint8Array): string =>
    typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");

  return {
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
    io: {
      stdout: {
        write: (chunk) => {
          stdout += append(chunk);
          return true;
        },
      },
      stderr: {
        write: (chunk) => {
          stderr += append(chunk);
          return true;
        },
      },
    },
  };
}

async function withStartedCli(
  args: string[],
  verify: (url: URL) => Promise<void>
): Promise<{ exitCode: number; output: CapturedOutput }> {
  const output = createCapturedOutput();
  const exitCode = await runCli(args, {
    stdout: output.io.stdout,
    stderr: output.io.stderr,
    waitForShutdown: async (shutdown) => {
      const url = new URL(output.stdout.trim());

      try {
        await verify(url);
      } finally {
        await shutdown();
      }
    },
  });

  if (exitCode !== 0) {
    throw new Error(output.stderr.trim().length > 0 ? output.stderr.trim() : output.stdout.trim());
  }

  return { exitCode, output };
}

async function postInitialize(url: URL): Promise<Response> {
  return nodeFetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(1_000),
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(initializeRequest),
  });
}

async function nodeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input));
  const client = url.protocol === "https:" ? https : http;
  const headers = new Headers(init.headers);

  return new Promise<Response>((resolve, reject) => {
    const request = client.request(
      {
        method: init.method ?? "GET",
        hostname: url.hostname,
        port: url.port.length > 0 ? Number(url.port) : url.protocol === "https:" ? 443 : 80,
        path: `${url.pathname}${url.search}`,
        headers: Object.fromEntries(headers.entries()),
      },
      (response) => {
        const responseHeaders = new Headers();

        for (const [key, value] of Object.entries(response.headers)) {
          if (typeof value === "string") {
            responseHeaders.set(key, value);
            continue;
          }

          if (Array.isArray(value)) {
            responseHeaders.set(key, value.join(", "));
          }
        }

        const body =
          response.statusCode === 204
            ? null
            : (Readable.toWeb(response) as ReadableStream<Uint8Array>);

        resolve(
          new Response(body, {
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? "",
            headers: responseHeaders,
          })
        );
      }
    );

    request.on("error", reject);

    if (init.signal !== undefined) {
      const onAbort = () => {
        request.destroy(new Error("Request aborted"));
      };

      if (init.signal.aborted) {
        onAbort();
        return;
      }

      init.signal.addEventListener("abort", onAbort, { once: true });
      request.once("close", () => {
        init.signal?.removeEventListener("abort", onAbort);
      });
    }

    if (typeof init.body === "string" || init.body instanceof Uint8Array) {
      request.write(init.body);
    }

    request.end();
  });
}

function waitForListening(
  child: ChildProcessWithoutNullStreams
): Promise<{ url: URL; stderr: () => string }> {
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
      const newlineIndex = stdout.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = stdout.slice(0, newlineIndex).trim();
      if (line.length === 0) {
        return;
      }

      cleanup();
      resolve({
        url: new URL(line),
        stderr: () => stderr,
      });
    };

    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `CLI exited before listening (code=${String(code)}, signal=${String(signal)}): ${stderr}`
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

describe("tiny-http-mcp-server CLI", () => {
  it("C1 starts server on default port 3000", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const listenHttp = vi.fn().mockResolvedValue({
      url: "http://127.0.0.1:3000/mcp",
      port: 3000,
      close,
    });
    const createServer = vi.fn(() => ({ listenHttp }));
    const output = createCapturedOutput();

    const exitCode = await runCli([], {
      createServer,
      stdout: output.io.stdout,
      stderr: output.io.stderr,
      waitForShutdown: async (shutdown) => {
        await shutdown();
      },
    });

    expect(exitCode).toBe(0);
    expect(listenHttp).toHaveBeenCalledWith({
      port: 3000,
      hostname: "127.0.0.1",
      path: "/mcp",
    });
    expect(output.stdout).toBe("http://127.0.0.1:3000/mcp\n");
  });

  it("C2 --port 0 picks random port", async () => {
    const { exitCode } = await withStartedCli(["--port", "0"], async (url) => {
      expect(Number(url.port)).toBeGreaterThan(0);

      const response = await postInitialize(url);

      expect(response.status).toBe(200);
      await response.text();
    });

    expect(exitCode).toBe(0);
  });

  it("C3 --hostname 127.0.0.1 binds correctly", async () => {
    const { exitCode } = await withStartedCli(
      ["--port", "0", "--hostname", "127.0.0.1"],
      async (url) => {
        expect(url.hostname).toBe("127.0.0.1");

        const response = await postInitialize(url);

        expect(response.status).toBe(200);
        await response.text();
      }
    );

    expect(exitCode).toBe(0);
  });

  it("C4 --path /api/mcp uses custom path", async () => {
    const { exitCode } = await withStartedCli(
      ["--port", "0", "--path", "/api/mcp"],
      async (url) => {
        expect(url.pathname).toBe("/api/mcp");

        const customPathResponse = await postInitialize(url);
        const defaultPathResponse = await postInitialize(new URL("/mcp", url));

        expect(customPathResponse.status).toBe(200);
        expect(defaultPathResponse.status).toBe(404);
        await customPathResponse.text();
        await defaultPathResponse.text();
      }
    );

    expect(exitCode).toBe(0);
  });

  it("C5 --stateless disables sessions", async () => {
    const { exitCode } = await withStartedCli(
      ["--port", "0", "--stateless"],
      async (url) => {
        const response = await postInitialize(url);

        expect(response.status).toBe(200);
        expect(response.headers.get("mcp-session-id")).toBeNull();
        await response.text();
      }
    );

    expect(exitCode).toBe(0);
  });

  it("C6 --json-response returns JSON content-type", async () => {
    const { exitCode } = await withStartedCli(
      ["--port", "0", "--json-response"],
      async (url) => {
        const response = await postInitialize(url);

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json");
        await response.text();
      }
    );

    expect(exitCode).toBe(0);
  });

  it("C7 -h/--help shows help and exits with code 0", async () => {
    const createServer = vi.fn();
    const shortOutput = createCapturedOutput();
    const longOutput = createCapturedOutput();

    const shortExitCode = await runCli(["-h"], {
      createServer,
      stdout: shortOutput.io.stdout,
      stderr: shortOutput.io.stderr,
    });
    const longExitCode = await runCli(["--help"], {
      createServer,
      stdout: longOutput.io.stdout,
      stderr: longOutput.io.stderr,
    });

    expect(shortExitCode).toBe(0);
    expect(longExitCode).toBe(0);
    expect(createServer).not.toHaveBeenCalled();
    expect(shortOutput.stdout).toContain("Usage: tiny-http-mcp-server [options]");
    expect(shortOutput.stdout).toContain("--json-response");
    expect(longOutput.stdout).toContain("-h, --help");
  });

  it("C8 SIGINT triggers graceful shutdown", async () => {
    const env = { ...process.env };
    delete env.FORCE_COLOR;
    delete env.NO_COLOR;
    const child = spawn(process.execPath, [tsxCliPath, cliSourcePath, "--port", "0"], {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChildren.add(child);

    const { url, stderr } = await waitForListening(child);
    const exitPromise = waitForExit(child);

    child.kill("SIGINT");

    const result = await exitPromise;
    activeChildren.delete(child);

    expect(result).toEqual({ code: 0, signal: null });
    await expect(
      nodeFetch(url, {
        signal: AbortSignal.timeout(500),
      })
    ).rejects.toThrow();
    expect(stderr()).toBe("");
  });
});
