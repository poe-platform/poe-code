import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, stat, unlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpClient, createSdkTestPair } from "tiny-mcp-client";
import type { Command, Group } from "./index.js";
import { hasOwnErrorCode } from "./error-codes.js";
import { defineGroup } from "./index.js";
import { runCLI } from "./cli.js";
import { resolveMcpProxies } from "./mcp-proxy.js";
import { createMCPServer } from "./mcp.js";
import { createSDK } from "./sdk.js";

const originalArgv = [...process.argv];
const originalRefresh = process.env.TOOLCRAFT_MCP_REFRESH;

const testServerCli = fileURLToPath(
  new URL("../../tiny-stdio-mcp-test-server/dist/cli.js", import.meta.url)
);
const tsxLoader = fileURLToPath(
  new URL("../../../node_modules/tsx/dist/loader.mjs", import.meta.url)
);
const indexModuleUrl = pathToFileURL(
  fileURLToPath(new URL("./index.ts", import.meta.url))
).href;
const cliModuleUrl = pathToFileURL(
  fileURLToPath(new URL("./cli.ts", import.meta.url))
).href;
const mcpModuleUrl = pathToFileURL(
  fileURLToPath(new URL("./mcp.ts", import.meta.url))
).href;

type ProxyHarness = {
  cachePath: string;
  countFile: string;
  pidFile: string;
  projectRoot: string;
  toolCallFile: string;
  workdir: string;
};

type ChildCollector = {
  child: ChildProcessWithoutNullStreams;
  nextStdoutLine(timeoutMs?: number): Promise<string>;
  stderr(): string;
  stdout(): string;
};

function readOutput(spy: ReturnType<typeof vi.spyOn>): string {
  return spy.mock.calls.map(([chunk]) => String(chunk)).join("");
}

function createContext(params: Record<string, unknown>) {
  return {
    params,
    secrets: {},
    fetch: globalThis.fetch,
    fs: {
      readFile: async () => "",
      writeFile: async () => undefined,
      exists: async () => false,
    },
    env: {
      get: () => undefined,
    },
    diagnostics: { level: "silent" as const, emit: () => undefined },
    progress: () => undefined,
  } as const;
}

async function createHarness(): Promise<ProxyHarness> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "toolcraft-mcp-proxy-"));
  const workdir = path.join(projectRoot, "packages", "toolcraft");

  await mkdir(workdir, { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    `${JSON.stringify({ name: "toolcraft-mcp-proxy-integration" }, null, 2)}\n`
  );

  return {
    projectRoot,
    workdir,
    cachePath: path.join(projectRoot, ".toolcraft", "mcp", "github.json"),
    countFile: path.join(projectRoot, ".toolcraft-test-spawn-count"),
    pidFile: path.join(projectRoot, ".toolcraft-test-wrapper-pid"),
    toolCallFile: path.join(projectRoot, ".toolcraft-test-tool-calls"),
  };
}

function createProxyRoot(
  harness: ProxyHarness,
  options: {
    command?: string;
    env?: Record<string, string>;
    name?: string;
    rename?: Record<string, string>;
    scope?: Array<"cli" | "sdk" | "mcp">;
  } = {}
): { github: Group<any>; root: Group<any> } {
  const github = defineGroup({
    name: options.name ?? "github",
    scope: options.scope ?? ["cli", "sdk", "mcp"],
    mcp: {
      transport: "stdio",
      command: options.command ?? process.execPath,
      args:
        options.command === undefined
          ? [testServerCli, "serve", "encrypt"]
          : undefined,
      env:
        options.command === undefined
          ? {
              TOOLCRAFT_TEST_SERVER_CLI: testServerCli,
              TOOLCRAFT_TEST_SPAWN_COUNT_FILE: harness.countFile,
              TOOLCRAFT_TEST_WRAPPER_PID_FILE: harness.pidFile,
              TOOLCRAFT_TEST_TOOL_CALL_FILE: harness.toolCallFile,
              TOOLCRAFT_TEST_STARTUP_DELAY_MS: "0",
              ...(options.env ?? {}),
            }
          : options.env,
    },
    ...(options.rename === undefined ? {} : { rename: options.rename }),
    children: [],
  });

  const root = defineGroup({
    name: "root",
    children: [github],
  });

  return {
    root,
    github: root.children[0] as Group<any>,
  };
}

function setProjectRoot(harness: ProxyHarness): void {
  vi.spyOn(process, "cwd").mockReturnValue(harness.workdir);
}

function getCommand(
  group: Group<any>,
  segments: string[]
): Command<any, any, any, any> {
  let current = group;

  for (const segment of segments.slice(0, -1)) {
    const next = current.children.find(
      (child) => child.kind === "group" && child.name === segment
    );

    if (next === undefined || next.kind !== "group") {
      throw new Error(`Expected group "${segment}" under "${current.name}"`);
    }

    current = next;
  }

  const commandName = segments[segments.length - 1];
  const command = current.children.find(
    (child) => child.kind === "command" && child.name === commandName
  );

  if (command === undefined || command.kind !== "command") {
    throw new Error(`Expected command "${segments.join(".")}"`);
  }

  return command;
}

async function callCommand(
  group: Group<any>,
  segments: string[],
  params: Record<string, unknown>
): Promise<unknown> {
  const command = getCommand(group, segments);
  return command.handler(createContext(params));
}

async function readNumberFile(filePath: string): Promise<number> {
  try {
    const value = (await readFile(filePath, "utf8")).trim();
    return value.length === 0 ? 0 : Number.parseInt(value, 10);
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return 0;
    }

    throw error;
  }
}

async function readLinesFile(filePath: string): Promise<string[]> {
  try {
    const contents = await readFile(filePath, "utf8");
    return contents
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
}

async function removeFileIfPresent(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!hasOwnErrorCode(error, "ENOENT")) {
      throw error;
    }
  }
}

async function resetObservedState(harness: ProxyHarness): Promise<void> {
  await Promise.all([
    removeFileIfPresent(harness.countFile),
    removeFileIfPresent(harness.pidFile),
    removeFileIfPresent(harness.toolCallFile),
  ]);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5000
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function waitForProcessExit(pid: number, timeoutMs = 5000): Promise<void> {
  await waitFor(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return hasOwnErrorCode(error, "ESRCH");
    }
  }, timeoutMs);
}

async function killWrapper(harness: ProxyHarness): Promise<void> {
  const pidValue = await readNumberFile(harness.pidFile);

  if (pidValue === 0) {
    return;
  }

  try {
    process.kill(pidValue, "SIGTERM");
  } catch (error) {
    if (!hasOwnErrorCode(error, "ESRCH")) {
      throw error;
    }
  }

  await waitForProcessExit(pidValue);
}

function spawnToolcraftRuntime(
  harness: ProxyHarness,
  source: string,
  env: Record<string, string | undefined> = {}
): ChildCollector {
  const child = spawn(
    process.execPath,
    ["--import", tsxLoader, "--input-type=module", "--eval", source],
    {
    cwd: harness.workdir,
    env: {
      ...process.env,
      TOOLCRAFT_TEST_SERVER_CLI: testServerCli,
      TOOLCRAFT_TEST_SPAWN_COUNT_FILE: harness.countFile,
      TOOLCRAFT_TEST_WRAPPER_PID_FILE: harness.pidFile,
      TOOLCRAFT_TEST_TOOL_CALL_FILE: harness.toolCallFile,
      TOOLCRAFT_TEST_STARTUP_DELAY_MS: "0",
      ...env,
    },
    stdio: ["pipe", "pipe", "pipe"],
    }
  );

  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdoutLines: string[] = [];
  const stdoutWaiters: Array<(line: string) => void> = [];
  let stdoutBuffer = "";

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    stdoutChunks.push(text);
    stdoutBuffer += text;

    while (true) {
      const newlineIndex = stdoutBuffer.indexOf("\n");

      if (newlineIndex === -1) {
        break;
      }

      const line = stdoutBuffer.slice(0, newlineIndex);
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);

      const waiter = stdoutWaiters.shift();
      if (waiter === undefined) {
        stdoutLines.push(line);
        continue;
      }

      waiter(line);
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrChunks.push(chunk.toString("utf8"));
  });

  return {
    child,
    nextStdoutLine(timeoutMs = 5000) {
      if (stdoutLines.length > 0) {
        return Promise.resolve(stdoutLines.shift() as string);
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for stdout line after ${timeoutMs}ms`));
        }, timeoutMs);

        stdoutWaiters.push((line) => {
          clearTimeout(timeout);
          resolve(line);
        });
      });
    },
    stderr() {
      return stderrChunks.join("");
    },
    stdout() {
      return stdoutChunks.join("");
    },
  };
}

async function waitForChildExit(
  child: ChildProcessWithoutNullStreams
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolve({ code, signal });
    });
  });
}

describe("mcp proxy integration", () => {
  const harnesses: ProxyHarness[] = [];

  beforeEach(() => {
    process.argv = [...originalArgv];
    process.exitCode = undefined;
    delete process.env.TOOLCRAFT_MCP_REFRESH;
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    process.argv = [...originalArgv];
    process.exitCode = undefined;

    if (originalRefresh === undefined) {
      delete process.env.TOOLCRAFT_MCP_REFRESH;
    } else {
      process.env.TOOLCRAFT_MCP_REFRESH = originalRefresh;
    }

    vi.restoreAllMocks();

    while (harnesses.length > 0) {
      const harness = harnesses.pop();

      if (harness === undefined) {
        continue;
      }

      await killWrapper(harness);
      await rm(harness.projectRoot, { recursive: true, force: true });
    }
  });

  it("discovers tools on first run, writes cache, populates children, and forwards tool calls", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    setProjectRoot(harness);

    const { github, root } = createProxyRoot(harness);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await resolveMcpProxies(root);

    const cache = JSON.parse(await readFile(harness.cachePath, "utf8")) as {
      tools: Array<{ name: string }>;
    };

    expect(readOutput(stderrWrite)).toContain("MCP github: connecting");
    expect(await pathExists(harness.cachePath)).toBe(true);
    expect(cache.tools.map((tool) => tool.name)).toEqual(["caesar_cipher_encrypt"]);
    expect(github.children).toHaveLength(1);
    expect(github.children[0]).toMatchObject({
      kind: "command",
      name: "caesar_cipher_encrypt",
    });

    const result = await callCommand(github, ["caesar_cipher_encrypt"], {
      text: "hello",
    });

    expect(result).toEqual({
      content: [{ type: "text", text: "khoor" }],
    });
  });

  it("uses the cache on the second run and opens one hot upstream connection on demand", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    setProjectRoot(harness);

    await resolveMcpProxies(createProxyRoot(harness).root);
    await resetObservedState(harness);

    const { github, root } = createProxyRoot(harness);
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stderrWrite.mockClear();

    await resolveMcpProxies(root);

    expect(readOutput(stderrWrite)).toBe("");
    expect(await readNumberFile(harness.countFile)).toBe(0);

    const firstResult = await callCommand(github, ["caesar_cipher_encrypt"], {
      text: "hello",
    });
    const secondResult = await callCommand(github, ["caesar_cipher_encrypt"], {
      text: "abc",
    });
    const thirdResult = await callCommand(github, ["caesar_cipher_encrypt"], {
      text: "xyz",
    });

    expect(firstResult).toEqual({
      content: [{ type: "text", text: "khoor" }],
    });
    expect(secondResult).toEqual({
      content: [{ type: "text", text: "def" }],
    });
    expect(thirdResult).toEqual({
      content: [{ type: "text", text: "abc" }],
    });
    expect(await readNumberFile(harness.countFile)).toBe(1);
    expect(await readLinesFile(harness.toolCallFile)).toEqual([
      "caesar_cipher_encrypt",
      "caesar_cipher_encrypt",
      "caesar_cipher_encrypt",
    ]);
  });

  it("retains and replaces the cache when TOOLCRAFT_MCP_REFRESH matches the group name", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    setProjectRoot(harness);

    await resolveMcpProxies(createProxyRoot(harness).root);
    const stableTimestamp = new Date(1_700_000_000_000);
    await utimes(harness.cachePath, stableTimestamp, stableTimestamp);
    const beforeRefresh = await stat(harness.cachePath);
    const startupGateFile = path.join(harness.projectRoot, ".toolcraft-test-startup-gate");

    process.env.TOOLCRAFT_MCP_REFRESH = "github";
    const { root } = createProxyRoot(harness, {
      env: {
        TOOLCRAFT_TEST_STARTUP_GATE_FILE: startupGateFile,
      },
    });
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    const pendingRefresh = resolveMcpProxies(root);

    await waitFor(async () => (await readNumberFile(harness.countFile)) === 2);
    expect(await pathExists(harness.cachePath)).toBe(true);
    expect((await stat(harness.cachePath)).mtimeMs).toBe(beforeRefresh.mtimeMs);
    await writeFile(startupGateFile, "ready");
    await pendingRefresh;

    const afterRefresh = await stat(harness.cachePath);

    expect(afterRefresh.mtimeMs).toBeGreaterThan(beforeRefresh.mtimeMs);
    expect(readOutput(stderrWrite)).toContain("MCP github: connecting");
    expect(readOutput(stderrWrite)).toContain("MCP github: wrote");
  });

  it("replaces and reconnects hot upstream subprocesses", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    setProjectRoot(harness);

    const { github, root } = createProxyRoot(harness);
    await resolveMcpProxies(root);
    await resetObservedState(harness);

    expect(
      await callCommand(github, ["caesar_cipher_encrypt"], { text: "hello" })
    ).toEqual({
      content: [{ type: "text", text: "khoor" }],
    });

    const firstPid = await readNumberFile(harness.pidFile);
    expect(firstPid).toBeGreaterThan(0);
    expect(await readNumberFile(harness.countFile)).toBe(1);

    await resolveMcpProxies(root);
    await waitForProcessExit(firstPid);

    expect(
      await callCommand(github, ["caesar_cipher_encrypt"], { text: "abc" })
    ).toEqual({
      content: [{ type: "text", text: "def" }],
    });

    const secondPid = await readNumberFile(harness.pidFile);
    expect(secondPid).toBeGreaterThan(0);
    expect(secondPid).not.toBe(firstPid);
    expect(await readNumberFile(harness.countFile)).toBe(2);
    process.kill(secondPid, "SIGTERM");
    await waitForProcessExit(secondPid);

    expect(
      await callCommand(github, ["caesar_cipher_encrypt"], { text: "xyz" })
    ).toEqual({
      content: [{ type: "text", text: "abc" }],
    });
    expect(await readNumberFile(harness.countFile)).toBe(3);
  });

  it("keeps discovery output off stdout in runMCP mode", async () => {
    const harness = await createHarness();
    harnesses.push(harness);

    const runtime = spawnToolcraftRuntime(
      harness,
      `
        import { defineGroup } from ${JSON.stringify(indexModuleUrl)};
        import { runMCP } from ${JSON.stringify(mcpModuleUrl)};

        void (async () => {
          const root = defineGroup({
            name: "root",
            children: [
              defineGroup({
                name: "github",
                scope: ["cli", "sdk", "mcp"],
                mcp: {
                  transport: "stdio",
                  command: ${JSON.stringify(process.execPath)},
                  args: [process.env.TOOLCRAFT_TEST_SERVER_CLI, "serve", "encrypt"],
                  env: {
                    TOOLCRAFT_TEST_SPAWN_COUNT_FILE: process.env.TOOLCRAFT_TEST_SPAWN_COUNT_FILE,
                    TOOLCRAFT_TEST_WRAPPER_PID_FILE: process.env.TOOLCRAFT_TEST_WRAPPER_PID_FILE,
                    TOOLCRAFT_TEST_TOOL_CALL_FILE: process.env.TOOLCRAFT_TEST_TOOL_CALL_FILE,
                    TOOLCRAFT_TEST_STARTUP_DELAY_MS: process.env.TOOLCRAFT_TEST_STARTUP_DELAY_MS ?? "0",
                  },
                },
                children: [],
              }),
            ],
          });

          await runMCP(root, {
            name: "toolcraft-test",
            version: "1.0.0",
          });
        })().catch((error) => {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
        });
      `
    );

    await waitFor(async () => await pathExists(harness.cachePath));
    expect(runtime.stdout()).toBe("");

    runtime.child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: {
            name: "toolcraft-mcp-proxy-integration",
            version: "1.0.0",
          },
        },
      })}\n`
    );

    const initializeLine = await runtime.nextStdoutLine();
    const response = JSON.parse(initializeLine) as {
      id: number;
      jsonrpc: string;
      result: {
        serverInfo: { name: string; version: string };
      };
    };

    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(1);
    expect(response.result.serverInfo).toEqual({
      name: "toolcraft-test",
      version: "1.0.0",
    });

    runtime.child.kill("SIGTERM");
    await waitForChildExit(runtime.child);
  });

  it("rejects on discovery failure and exits non-zero in runtime mode", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    setProjectRoot(harness);

    const missingCommand = "__toolcraft_missing_mcp_binary__";
    const { root } = createProxyRoot(harness, {
      command: missingCommand,
    });

    await expect(resolveMcpProxies(root)).rejects.toThrow(
      `couldn't discover MCP github`
    );

    const runtime = spawnToolcraftRuntime(
      harness,
      `
        import { defineGroup } from ${JSON.stringify(indexModuleUrl)};
        import { runCLI } from ${JSON.stringify(cliModuleUrl)};

        void (async () => {
          process.argv = ["node", "toolcraft", "github", "--help"];

          const root = defineGroup({
            name: "root",
            children: [
              defineGroup({
                name: "github",
                scope: ["cli", "sdk", "mcp"],
                mcp: {
                  transport: "stdio",
                  command: ${JSON.stringify(missingCommand)},
                },
                children: [],
              }),
            ],
          });

          await runCLI(root);
          process.exit(process.exitCode ?? 0);
        })().catch((error) => {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
        });
      `
    );

    const exit = await waitForChildExit(runtime.child);

    expect(exit.code).toBe(1);
    expect(`${runtime.stdout()}\n${runtime.stderr()}`).toContain("couldn't discover MCP github");
  });

  it("applies rename maps consistently across CLI, SDK, MCP, and upstream wire calls", async () => {
    const harness = await createHarness();
    harnesses.push(harness);
    setProjectRoot(harness);

    const rename = {
      caesar_cipher_encrypt: "sub.renamed",
    };

    await resolveMcpProxies(createProxyRoot(harness, { rename }).root);
    await resetObservedState(harness);

    const cliRoot = createProxyRoot(harness, { rename }).root;
    const stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    process.argv = [
      "node",
      "toolcraft",
      "github",
      "sub",
      "renamed",
      "--text",
      "hello",
      "--output",
      "json",
      "--yes",
    ];

    await runCLI(cliRoot, { controls: { output: true, yes: true } });

    expect(JSON.parse(readOutput(stdoutWrite))).toEqual({
      result: "khoor",
    });

    const sdk = createSDK(createProxyRoot(harness, { rename }).root) as {
      github: {
        sub: {
          renamed(params: { text: string }): Promise<unknown>;
        };
      };
    };

    expect(
      await sdk.github.sub.renamed({
        text: "abc",
      })
    ).toEqual({
      content: [{ type: "text", text: "def" }],
    });

    const server = createMCPServer(createProxyRoot(harness, { rename }).root, {
      name: "toolcraft-test",
      version: "1.0.0",
      omitRootToolNamePrefix: true,
    });
    const { client, cleanup } = await createSdkTestPair(server, () =>
      new McpClient({
        clientInfo: {
          name: "toolcraft-mcp-proxy-integration",
          version: "1.0.0",
        },
      })
    );

    try {
      const { tools } = await client.listTools();

      expect(tools.map((tool) => tool.name)).toContain("github__sub__renamed");
      const result = await client.callTool({
        name: "github__sub__renamed",
        arguments: { text: "xyz" },
      });

      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toMatchObject({ type: "text" });
      expect(
        JSON.parse((result.content[0] as { text: string }).text)
      ).toEqual({
        content: [{ type: "text", text: "abc" }],
      });
    } finally {
      await cleanup();
    }

    expect(await readLinesFile(harness.toolCallFile)).toEqual([
      "caesar_cipher_encrypt",
      "caesar_cipher_encrypt",
      "caesar_cipher_encrypt",
    ]);
  });
});
