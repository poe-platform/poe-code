#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createHttpServer } from "./http-server.js";
import type { HttpServer } from "./http-server.js";

interface PackageInfo {
  name: string;
  version: string;
}

interface ParsedCliArgs {
  help: boolean;
  port: number;
  hostname: string;
  path: string;
  stateless: boolean;
  jsonResponse: boolean;
}

type CliServerFactory = (
  options: Parameters<typeof createHttpServer>[0]
) => Pick<HttpServer, "listenHttp">;

interface RunCliDependencies {
  createServer?: CliServerFactory;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  waitForShutdown?: (shutdown: () => Promise<void>) => Promise<void>;
}

function readPackageInfo(): PackageInfo {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    ) as { name?: unknown; version?: unknown };

    if (
      typeof packageJson.name === "string" &&
      typeof packageJson.version === "string"
    ) {
      return {
        name: packageJson.name,
        version: packageJson.version,
      };
    }
  } catch {
    // Fall through to a stable default when package.json is unavailable.
  }

  return {
    name: "tiny-http-mcp-server",
    version: "0.0.0",
  };
}

const packageInfo = readPackageInfo();

const HELP_TEXT = [
  "Usage: tiny-http-mcp-server [options]",
  "",
  "Options:",
  "  --port <port>          Port to listen on (default: 3000)",
  "  --hostname <hostname>  Hostname to bind to (default: 127.0.0.1)",
  "  --path <path>          HTTP path to serve MCP on (default: /mcp)",
  "  --stateless            Disable session support",
  "  --json-response        Return application/json for POST responses",
  "  -h, --help             Show this help message",
].join("\n");

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 3000;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port must be an integer between 0 and 65535.");
  }

  return port;
}

function parseCliOptions(args: string[]): ParsedCliArgs {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      port: { type: "string" },
      hostname: { type: "string" },
      path: { type: "string" },
      stateless: { type: "boolean" },
      "json-response": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  return {
    help: values.help ?? false,
    port: parsePort(values.port),
    hostname: values.hostname ?? "127.0.0.1",
    path: values.path ?? "/mcp",
    stateless: values.stateless ?? false,
    jsonResponse: values["json-response"] ?? false,
  };
}

function waitForShutdown(shutdown: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSignal = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      void shutdown().then(resolve, reject);
    };

    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

export function isCliInvocation(
  argv: string[],
  moduleUrl: string,
  realpath: (path: string) => string = realpathSync
): boolean {
  const entry = argv.at(1);
  if (typeof entry !== "string") {
    return false;
  }

  const candidates = [pathToFileURL(entry).href];
  try {
    candidates.push(pathToFileURL(realpath(entry)).href);
  } catch {
    // Ignore resolution failures and keep the direct path candidate.
  }

  return candidates.includes(moduleUrl);
}

export async function runCli(
  args: string[] = process.argv.slice(2),
  dependencies: RunCliDependencies = {}
): Promise<number> {
  const createServer = dependencies.createServer ?? createHttpServer;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const waitForShutdownImpl = dependencies.waitForShutdown ?? waitForShutdown;
  let handle: Awaited<ReturnType<HttpServer["listenHttp"]>> | undefined;

  try {
    const options = parseCliOptions(args);

    if (options.help) {
      stdout.write(`${HELP_TEXT}\n`);
      return 0;
    }

    const server = createServer({
      name: packageInfo.name,
      version: packageInfo.version,
      ...(options.stateless ? { sessionIdGenerator: undefined } : {}),
      ...(options.jsonResponse ? { enableJsonResponse: true } : {}),
    });

    handle = await server.listenHttp({
      port: options.port,
      hostname: options.hostname,
      path: options.path,
    });

    stdout.write(`${handle.url}\n`);
    await waitForShutdownImpl(async () => {
      await handle?.close();
    });

    return 0;
  } catch (error) {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // Preserve the original CLI failure below.
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }
}

if (isCliInvocation(process.argv, import.meta.url)) {
  runCli().then((code) => {
    process.exit(code);
  });
}
