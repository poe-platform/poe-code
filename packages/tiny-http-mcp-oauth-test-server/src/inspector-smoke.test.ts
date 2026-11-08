/**
 * This smoke test uses the published `npx --yes @modelcontextprotocol/inspector`
 * CLI in `--cli` mode instead of the browser UI. The shipped CLI path forwards to
 * the inspector's method runner, which calls `Client.connect()` before invoking
 * `tools/list`. A successful `tools/list` response therefore proves that inspector
 * completed the MCP `initialize` handshake and could enumerate the protected
 * server's bundled tools.
 *
 * The published inspector currently requires Node >=22.7.5. On older runtimes we
 * skip this test instead of failing because the official headless client cannot run
 * there.
 */

import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpOAuthTestServer } from "./index.js";

interface InspectorRunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

interface InspectorToolsListResult {
  tools: Array<{ name: string }>;
}

const INSPECTOR_MINIMUM_NODE_VERSION = {
  major: 22,
  minor: 7,
  patch: 5,
} as const;
const INSPECTOR_TIMEOUT_MS = 30_000;
const inspectorIt =
  process.env.RUN_INSPECTOR_SMOKE === "1" && supportsHeadlessInspector(process.versions.node)
    ? it
    : it.skip;

function supportsHeadlessInspector(version: string): boolean {
  const [majorText = "0", minorText = "0", patchText = "0"] = version.split(".");
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);

  if (major !== INSPECTOR_MINIMUM_NODE_VERSION.major) {
    return major > INSPECTOR_MINIMUM_NODE_VERSION.major;
  }

  if (minor !== INSPECTOR_MINIMUM_NODE_VERSION.minor) {
    return minor > INSPECTOR_MINIMUM_NODE_VERSION.minor;
  }

  return patch >= INSPECTOR_MINIMUM_NODE_VERSION.patch;
}

function getNpxExecutable(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function parseInspectorTools(stdout: string): string[] {
  const objectStart = stdout.indexOf("{");
  const objectEnd = stdout.lastIndexOf("}");

  if (objectStart === -1 || objectEnd === -1 || objectEnd < objectStart) {
    throw new Error(`Expected inspector JSON output, received:\n${stdout}`);
  }

  const payload = JSON.parse(stdout.slice(objectStart, objectEnd + 1)) as
    | InspectorToolsListResult
    | undefined;
  const tools = payload?.tools;

  if (!Array.isArray(tools)) {
    throw new Error(`Expected inspector tools/list payload, received:\n${stdout}`);
  }

  return tools
    .map((tool) => tool?.name)
    .filter((name): name is string => typeof name === "string");
}

function runInspectorToolsList(
  childProcesses: Set<ChildProcessWithoutNullStreams>,
  input: { token: string; url: string }
): Promise<InspectorRunResult> {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      MCP_AUTO_OPEN_ENABLED: "false",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_prefer_offline: "true",
    };
    const child = spawn(
      getNpxExecutable(),
      [
        "--yes",
        "@modelcontextprotocol/inspector",
        "--cli",
        "--transport",
        "http",
        "--header",
        `Authorization: Bearer ${input.token}`,
        "--",
        input.url,
        "--method",
        "tools/list",
      ],
      {
        cwd: new URL("../../..", import.meta.url),
        env,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    childProcesses.add(child);

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, INSPECTOR_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeout);
      childProcesses.delete(child);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
      child.off("error", onError);
    };

    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    };

    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      resolve({
        code,
        signal,
        stderr,
        stdout,
        timedOut,
      });
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

describe("tiny-http-mcp-oauth-test-server inspector smoke test", () => {
  const activeChildren = new Set<ChildProcessWithoutNullStreams>();

  afterEach(() => {
    for (const child of activeChildren) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    }

    activeChildren.clear();
  });

  inspectorIt(
    "lets the official inspector initialize the protected MCP server and list bundled tools",
    async () => {
      const server = createMcpOAuthTestServer({
        autoApprove: true,
        scopes: ["mcp.read"],
      });
      const handle = await server.listen({ port: 0, hostname: "127.0.0.1" });

      try {
        const token = await handle.oauth.issueTokenFor({
          clientId: "inspector-smoke-test",
          resource: handle.resource,
          scopes: ["mcp.read"],
        });
        const result = await runInspectorToolsList(activeChildren, {
          token,
          url: handle.mcpUrl,
        });

        if (result.timedOut || result.code !== 0 || result.signal !== null) {
          throw new Error(
            [
              "Inspector smoke test failed.",
              `exitCode=${String(result.code)}`,
              `signal=${String(result.signal)}`,
              `timedOut=${String(result.timedOut)}`,
              `stdout:\n${result.stdout}`,
              `stderr:\n${result.stderr}`,
            ].join("\n")
          );
        }

        expect(parseInspectorTools(result.stdout)).toEqual(
          expect.arrayContaining(["echo", "reverse", "uppercase", "get_user"])
        );
      } finally {
        await handle.close();
      }
    },
    INSPECTOR_TIMEOUT_MS + 1_000
  );
});
