#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  createMcpOAuthTestServer,
  type McpOAuthTestServerListenOptions,
  type McpOAuthTestServerOptions,
} from "./index.js";

interface PackageInfo {
  name: string;
  version: string;
}

interface ParsedCliArgs {
  help: boolean;
  port: number;
  hostname: string;
  mcpPath?: string;
  issuer?: string;
  resource?: string;
  ttlSeconds: number;
  autoApprove: boolean;
  scopes?: string[];
  printTestToken: boolean;
}

interface RunCliDependencies {
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
      typeof packageJson.name === "string"
      && typeof packageJson.version === "string"
    ) {
      return {
        name: packageJson.name,
        version: packageJson.version,
      };
    }
  } catch {
    // Fall through to stable defaults when package.json is unavailable.
  }

  return {
    name: "tiny-http-mcp-oauth-test-server",
    version: "0.0.0",
  };
}

const packageInfo = readPackageInfo();

const HELP_TEXT = [
  "Usage: tiny-http-mcp-oauth-test-server [options]",
  "",
  "Options:",
  "  --port <port>               Port to listen on for the MCP endpoint (default: 0, ephemeral)",
  "  --hostname <hostname>       Hostname to bind to (default: 127.0.0.1)",
  "  --mcp-path <path>           MCP endpoint path (default: /mcp)",
  "  --issuer <url>              HTTP issuer URL for the embedded authorization server",
  "  --resource <url>            Canonical protected resource URI (default: MCP URL)",
  "  --ttl-seconds <seconds>     Access token TTL in seconds (default: 60)",
  "  --auto-approve              Auto-approve every OAuth authorization request",
  "  --scopes <scope1,scope2>    Comma-separated scopes to publish and require",
  "  --print-test-token          Print a sample bearer token for the configured resource",
  "  -h, --help                  Show this help message",
].join("\n");

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 0;
  }

  if (!isDecimalInteger(value)) {
    throw new Error("--port must be an integer between 0 and 65535.");
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port must be an integer between 0 and 65535.");
  }

  return port;
}

function parsePositiveInteger(value: string | undefined, flagName: string): number {
  if (value === undefined) {
    return 60;
  }

  if (!isDecimalInteger(value)) {
    throw new Error(`${flagName} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flagName} must be a positive integer.`);
  }

  return parsed;
}

function isDecimalInteger(value: string): boolean {
  return value.length > 0 && [...value].every((character) => character >= "0" && character <= "9");
}

function parseAbsoluteUrl(
  value: string | undefined,
  flagName: string
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${flagName} must be an absolute URL.`);
  }
}

function parseHttpUrl(
  value: string | undefined,
  flagName: string
): string | undefined {
  const url = parseAbsoluteUrl(value, flagName);
  if (url === undefined) {
    return undefined;
  }

  if (new URL(url).protocol !== "http:") {
    throw new Error(
      `${flagName} must use http: because the embedded authorization server does not terminate TLS.`
    );
  }

  if (new URL(url).pathname === "/") {
    throw new Error(
      `${flagName} must include a non-root path such as /oauth so OAuth discovery stays unambiguous.`
    );
  }

  return url;
}

function parseScopes(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const scopes = value
    .split(",")
    .map((scope) => scope.trim());

  if (scopes.some((scope) => scope.length === 0)) {
    throw new Error("--scopes must not contain empty entries.");
  }

  if (scopes.length === 0) {
    throw new Error("--scopes must include at least one non-empty scope.");
  }

  return scopes;
}

function parseCliOptions(args: string[]): ParsedCliArgs {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      port: { type: "string" },
      hostname: { type: "string" },
      "mcp-path": { type: "string" },
      issuer: { type: "string" },
      resource: { type: "string" },
      "ttl-seconds": { type: "string" },
      "auto-approve": { type: "boolean" },
      scopes: { type: "string" },
      "print-test-token": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  return {
    help: values.help ?? false,
    port: parsePort(values.port),
    hostname: values.hostname ?? "127.0.0.1",
    mcpPath: values["mcp-path"],
    issuer: parseHttpUrl(values.issuer, "--issuer"),
    resource: parseAbsoluteUrl(values.resource, "--resource"),
    ttlSeconds: parsePositiveInteger(values["ttl-seconds"], "--ttl-seconds"),
    autoApprove: values["auto-approve"] ?? false,
    scopes: parseScopes(values.scopes),
    printTestToken: values["print-test-token"] ?? false,
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
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;

  let parsed: ParsedCliArgs;

  try {
    parsed = parseCliOptions(args);
  } catch (error) {
    stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n\n${HELP_TEXT}\n`
    );
    return 1;
  }

  if (parsed.help) {
    stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  const serverOptions: McpOAuthTestServerOptions = {
    ...(parsed.mcpPath === undefined ? {} : { mcpPath: parsed.mcpPath }),
    ...(parsed.issuer === undefined ? {} : { issuer: parsed.issuer }),
    ...(parsed.resource === undefined ? {} : { resource: parsed.resource }),
    ttlSeconds: parsed.ttlSeconds,
    autoApprove: parsed.autoApprove,
    ...(parsed.scopes === undefined ? {} : { scopes: parsed.scopes }),
  };
  const listenOptions: McpOAuthTestServerListenOptions = {
    port: parsed.port,
    hostname: parsed.hostname,
  };
  let handle: Awaited<ReturnType<ReturnType<typeof createMcpOAuthTestServer>["listen"]>>;

  try {
    const server = createMcpOAuthTestServer(serverOptions);
    handle = await server.listen(listenOptions);

    stdout.write(`${packageInfo.name} ${packageInfo.version}\n`);
    stdout.write(`MCP URL: ${handle.mcpUrl}\n`);
    stdout.write(`PRM URL: ${handle.prmUrl}\n`);
    stdout.write(`AS issuer: ${handle.oauth.issuer}\n`);
    stdout.write(`Resource: ${handle.resource}\n`);

    if (parsed.printTestToken) {
      const token = await handle.oauth.issueTokenFor({
        clientId: "demo-client",
        resource: handle.resource,
        scopes: parsed.scopes ?? ["mcp.read"],
      });
      stdout.write(`Test bearer token: ${token}\n`);
    }
  } catch (error) {
    stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n\n${HELP_TEXT}\n`
    );
    return 1;
  }

  await (dependencies.waitForShutdown ?? waitForShutdown)(handle.close);
  return 0;
}

if (isCliInvocation(process.argv, import.meta.url)) {
  void runCli().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`
      );
      process.exitCode = 1;
    }
  );
}
