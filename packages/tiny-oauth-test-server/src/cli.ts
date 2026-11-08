#!/usr/bin/env node

import { readFileSync, realpathSync } from "node:fs";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  createOAuthTestServer,
  type OAuthTestServerListenOptions,
  type OAuthTestStaticClient,
} from "./index.js";

interface PackageInfo {
  name: string;
  version: string;
}

interface ParsedCliArgs {
  help: boolean;
  port: number;
  hostname: string;
  issuer?: string;
  ttlSeconds: number;
  autoApprove: boolean;
  staticClients: OAuthTestStaticClient[];
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
      typeof packageJson.name === "string" &&
      typeof packageJson.version === "string"
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
    name: "tiny-oauth-test-server",
    version: "0.0.0",
  };
}

const packageInfo = readPackageInfo();

const HELP_TEXT = [
  "Usage: tiny-oauth-test-server [options]",
  "",
  "Options:",
  "  --port <port>                               Port to listen on (default: 0, ephemeral)",
  "  --hostname <hostname>                       Hostname to bind to (default: 127.0.0.1)",
  "  --issuer <url>                              Issuer URL to publish in metadata and tokens",
  "  --ttl-seconds <seconds>                     Access token TTL in seconds (default: 60)",
  "  --auto-approve                              Auto-approve every authorization request",
  "  --static-client <client_id:redirect_uri[,redirect_uri...]>",
  "                                             Register a repeatable static client",
  "  -h, --help                                  Show this help message",
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

function parseIssuer(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  try {
    return new URL(value).toString();
  } catch {
    throw new Error("--issuer must be an absolute URL.");
  }
}

function parseStaticClientEntry(value: string): OAuthTestStaticClient {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
    throw new Error(
      "--static-client must use client_id:redirect_uri[,redirect_uri...] format."
    );
  }

  const clientId = value.slice(0, separatorIndex);
  const redirectUris = value
    .slice(separatorIndex + 1)
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (redirectUris.length === 0) {
    throw new Error("--static-client must include at least one redirect_uri.");
  }

  return {
    clientId,
    redirectUris,
  };
}

function parseCliOptions(args: string[]): ParsedCliArgs {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      port: { type: "string" },
      hostname: { type: "string" },
      issuer: { type: "string" },
      "ttl-seconds": { type: "string" },
      "auto-approve": { type: "boolean" },
      "static-client": { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
    },
  });

  return {
    help: values.help ?? false,
    port: parsePort(values.port),
    hostname: values.hostname ?? "127.0.0.1",
    issuer: parseIssuer(values.issuer),
    ttlSeconds: parsePositiveInteger(values["ttl-seconds"], "--ttl-seconds"),
    autoApprove: values["auto-approve"] ?? false,
    staticClients: (values["static-client"] ?? []).map(parseStaticClientEntry),
  };
}

function formatCurlInvocation(baseUrl: string): string {
  return [
    "curl -sS -X POST",
    `${baseUrl}/testing/issue-token`,
    "-H 'Content-Type: application/json'",
    "-d '{\"client_id\":\"demo-client\",\"resource\":\"https://resource.example.com/mcp\",\"scopes\":[\"mcp.read\"]}'",
  ].join(" ");
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

  const listenOptions: OAuthTestServerListenOptions = {
    port: parsed.port,
    hostname: parsed.hostname,
  };

  const server = createOAuthTestServer({
    issuer: parsed.issuer,
    defaultTokenTtlSeconds: parsed.ttlSeconds,
    staticClients: parsed.staticClients,
    defaultAuthorization: {
      autoApprove: parsed.autoApprove,
    },
  });

  const handle = await server.listen(listenOptions);
  const issuerUrl = new URL(server.issuer);
  const metadataSuffix = issuerUrl.pathname === "/" ? "" : issuerUrl.pathname.replace(/\/$/, "");
  const metadataUrl = `${issuerUrl.origin}/.well-known/oauth-authorization-server${metadataSuffix}`;

  stdout.write(`${packageInfo.name} ${packageInfo.version}\n`);
  stdout.write(`Bound URL: ${handle.url}\n`);
  stdout.write(`Issuer: ${server.issuer}\n`);
  stdout.write(`Authorization server metadata URL: ${metadataUrl}\n`);
  stdout.write(`Issue token curl: ${formatCurlInvocation(handle.url)}\n`);

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
