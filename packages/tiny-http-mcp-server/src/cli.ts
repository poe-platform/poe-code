#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { createHttpServer } from "./http-server.js";
import type { HttpServer } from "./http-server.js";
import { loadOAuthVerifier } from "./load-oauth-verifier.js";
import type { TokenVerifier } from "./auth.js";

// createRequire instead of JSON import attributes: `with { type: "json" }` is a
// syntax error before Node 18.20, and engines declares >=18.18 (#517).
const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { name: string; version: string };

interface PackageInfo {
  name: string;
  version: string;
}

interface ParsedCliArgs {
  help: boolean;
  version: boolean;
  port: number;
  hostname: string;
  path: string;
  stateless: boolean;
  jsonResponse: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  maxRequestBytes?: number;
  maxBatchSize?: number;
  maxSessions?: number;
  maxSessionsPerSubject?: number;
  sessionTtlMs?: number;
  maxStreamsPerSession?: number;
  maxStreamBufferBytes?: number;
  maxSseEventHistory?: number;
  sseKeepAliveMs?: number;
  maxConcurrentToolCalls?: number;
  trustedProxy: boolean;
  requestTimeoutMs?: number;
  headersTimeoutMs?: number;
  keepAliveTimeoutMs?: number;
  shutdownGraceMs: number;
  oauth?: {
    resource: string;
    authorizationServers: string[];
    requiredScopes?: string[];
    scopesSupported?: string[];
    bearerMethodsSupported?: string[];
    verifierModule: string;
    verifierExport: string;
  };
}

type CliServerFactory = (
  options: Parameters<typeof createHttpServer>[0]
) => Pick<HttpServer, "listenHttp">;

interface RunCliDependencies {
  createServer?: CliServerFactory;
  loadOAuthVerifier?: (input: { modulePath: string; exportName: string }) => Promise<TokenVerifier>;
  stdout?: Pick<NodeJS.WriteStream, "write">;
  stderr?: Pick<NodeJS.WriteStream, "write">;
  waitForShutdown?: (shutdown: () => Promise<void>) => Promise<void>;
  listenForShutdownSignals?: (listener: () => void) => () => void;
  scheduleShutdownGrace?: (listener: () => void, graceMs: number) => () => void;
}

function readPackageInfo(): PackageInfo {
  return {
    name: packageJson.name,
    version: packageJson.version
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
  "  --allowed-host <host>  Allowed Host header value (repeatable; default: localhost loopback hosts)",
  "  --allowed-origin <url> Allowed CORS Origin value (repeatable)",
  "  --max-request-bytes <bytes>",
  "                        Maximum JSON request body size",
  "  --max-batch-size <count>",
  "                        Maximum JSON-RPC batch member count",
  "  --max-sessions <count> Maximum active sessions (default: 128)",
  "  --max-sessions-per-subject <count>",
  "                        Maximum sessions per authenticated subject (default: 16)",
  "  --session-ttl-ms <ms>  Expire idle sessions (default: 900000)",
  "  --max-streams-per-session <count>",
  "                        Maximum concurrent GET SSE streams per session",
  "  --max-stream-buffer-bytes <bytes>",
  "                        Maximum buffered bytes per GET SSE stream (default: 1048576)",
  "  --max-sse-event-history <count>",
  "                        Number of SSE events retained for Last-Event-ID replay",
  "  --sse-keep-alive-ms <ms>",
  "                        GET SSE keepalive interval (default: 30000; 0 disables)",
  "  --max-concurrent-tool-calls <count>",
  "                        Maximum concurrent tool calls across sessions",
  "  --trusted-proxy        Trust X-Forwarded-Proto and X-Forwarded-Host",
  "  --request-timeout-ms <ms>",
  "                        Node HTTP request timeout",
  "  --headers-timeout-ms <ms>",
  "                        Node HTTP headers timeout",
  "  --keep-alive-timeout-ms <ms>",
  "                        Node HTTP keep-alive timeout",
  "  --shutdown-grace-ms <ms>",
  "                        Grace period before force-closing connections (default: 10000)",
  "  --oauth-resource <uri> Enable OAuth mode with this canonical resource URI",
  "  --oauth-authorization-server <issuer>",
  "                        Authorization server issuer URL (repeatable)",
  "  --oauth-supported-scope <scope>",
  "                        Scope published in OAuth metadata (repeatable)",
  "  --oauth-required-scope <scope>",
  "                        Scope required on MCP requests (repeatable)",
  "  --oauth-bearer-method <method>",
  "                        Bearer transport published in metadata (repeatable)",
  "  --oauth-verifier-module <path-or-file-url>",
  "                        Module that exports the TokenVerifier implementation",
  "  --oauth-verifier-export <name>",
  "                        Export name to load from the verifier module (default: default)",
  "  --version              Show the package version",
  "  -h, --help             Show this help message"
].join("\n");

function parsePort(value: string | undefined): number {
  if (value === undefined) {
    return 3000;
  }

  const port = parseDecimalInteger(value, "--port");
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port must be an integer between 0 and 65535.");
  }

  return port;
}

function parseAbsoluteUrl(value: string, flagName: string): string {
  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${flagName} must be an absolute URL.`);
  }
}

function parseOrigin(value: string, flagName: string): string {
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`${flagName} must be an absolute URL.`);
  }
}

function parseDecimalInteger(value: string, flagName: string): number {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${flagName} must be an integer.`);
  }

  for (const character of trimmed) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint < 48 || codePoint > 57) {
      throw new Error(`${flagName} must be an integer.`);
    }
  }

  return Number(trimmed);
}

function parseOptionalInteger(
  value: string | undefined,
  flagName: string,
  minimum: number
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = parseDecimalInteger(value, flagName);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${flagName} must be an integer greater than or equal to ${minimum}.`);
  }

  return parsed;
}

function hasConfiguredOAuthFlag(values: Record<string, unknown>): boolean {
  return [
    values["oauth-resource"],
    values["oauth-authorization-server"],
    values["oauth-supported-scope"],
    values["oauth-required-scope"],
    values["oauth-bearer-method"],
    values["oauth-verifier-module"],
    values["oauth-verifier-export"]
  ].some((value) => value !== undefined);
}

function parseRepeatableStrings(value: unknown, flagName: string): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(`${flagName} must be provided as a string.`);
    }

    const trimmed = item.trim();
    if (trimmed.length === 0) {
      throw new Error(`${flagName} must not be blank.`);
    }
    normalized.push(trimmed);
  }

  return normalized;
}

function parseCliOAuthOptions(values: Record<string, unknown>): ParsedCliArgs["oauth"] {
  const resource = values["oauth-resource"];
  const authorizationServers = values["oauth-authorization-server"];
  const verifierModule = values["oauth-verifier-module"];
  const verifierExport = values["oauth-verifier-export"];
  const hasOAuthFlags = hasConfiguredOAuthFlag(values);

  if (typeof resource !== "string") {
    if (hasOAuthFlags) {
      throw new Error("--oauth-resource is required when configuring OAuth.");
    }
    return undefined;
  }

  if (!Array.isArray(authorizationServers) || authorizationServers.length === 0) {
    throw new Error(
      "--oauth-authorization-server must be provided at least once when --oauth-resource is set."
    );
  }

  if (typeof verifierModule !== "string" || verifierModule.length === 0) {
    throw new Error("--oauth-verifier-module is required when --oauth-resource is set.");
  }

  const supportedScopes = parseRepeatableStrings(
    values["oauth-supported-scope"],
    "--oauth-supported-scope"
  );
  const requiredScopes = parseRepeatableStrings(
    values["oauth-required-scope"],
    "--oauth-required-scope"
  );
  const bearerMethods = parseRepeatableStrings(
    values["oauth-bearer-method"],
    "--oauth-bearer-method"
  );

  return {
    resource: parseAbsoluteUrl(resource, "--oauth-resource"),
    authorizationServers: authorizationServers.map((value) =>
      parseAbsoluteUrl(value, "--oauth-authorization-server")
    ),
    ...(requiredScopes === undefined ? {} : { requiredScopes }),
    ...(supportedScopes === undefined ? {} : { scopesSupported: supportedScopes }),
    ...(bearerMethods === undefined ? {} : { bearerMethodsSupported: bearerMethods }),
    verifierModule,
    verifierExport:
      typeof verifierExport === "string" && verifierExport.length > 0 ? verifierExport : "default"
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
      path: { type: "string" },
      stateless: { type: "boolean" },
      "json-response": { type: "boolean" },
      "allowed-host": { type: "string", multiple: true },
      "allowed-origin": { type: "string", multiple: true },
      "max-request-bytes": { type: "string" },
      "max-batch-size": { type: "string" },
      "max-sessions": { type: "string" },
      "max-sessions-per-subject": { type: "string" },
      "session-ttl-ms": { type: "string" },
      "max-streams-per-session": { type: "string" },
      "max-stream-buffer-bytes": { type: "string" },
      "max-sse-event-history": { type: "string" },
      "sse-keep-alive-ms": { type: "string" },
      "max-concurrent-tool-calls": { type: "string" },
      "trusted-proxy": { type: "boolean" },
      "request-timeout-ms": { type: "string" },
      "headers-timeout-ms": { type: "string" },
      "keep-alive-timeout-ms": { type: "string" },
      "shutdown-grace-ms": { type: "string" },
      "oauth-resource": { type: "string" },
      "oauth-authorization-server": { type: "string", multiple: true },
      "oauth-supported-scope": { type: "string", multiple: true },
      "oauth-required-scope": { type: "string", multiple: true },
      "oauth-bearer-method": { type: "string", multiple: true },
      "oauth-verifier-module": { type: "string" },
      "oauth-verifier-export": { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" }
    }
  });

  const maxRequestBytes = parseOptionalInteger(
    values["max-request-bytes"],
    "--max-request-bytes",
    1
  );
  const maxBatchSize = parseOptionalInteger(values["max-batch-size"], "--max-batch-size", 1);
  const maxSessions = parseOptionalInteger(values["max-sessions"], "--max-sessions", 1);
  const maxSessionsPerSubject = parseOptionalInteger(
    values["max-sessions-per-subject"], "--max-sessions-per-subject", 1
  );
  const sessionTtlMs = parseOptionalInteger(values["session-ttl-ms"], "--session-ttl-ms", 1);
  const maxStreamsPerSession = parseOptionalInteger(
    values["max-streams-per-session"],
    "--max-streams-per-session",
    1
  );
  const maxStreamBufferBytes = parseOptionalInteger(
    values["max-stream-buffer-bytes"],
    "--max-stream-buffer-bytes",
    0
  );
  const maxSseEventHistory = parseOptionalInteger(
    values["max-sse-event-history"],
    "--max-sse-event-history",
    0
  );
  const sseKeepAliveMs = parseOptionalInteger(
    values["sse-keep-alive-ms"],
    "--sse-keep-alive-ms",
    0
  );
  const maxConcurrentToolCalls = parseOptionalInteger(
    values["max-concurrent-tool-calls"],
    "--max-concurrent-tool-calls",
    1
  );
  const requestTimeoutMs = parseOptionalInteger(
    values["request-timeout-ms"],
    "--request-timeout-ms",
    0
  );
  const headersTimeoutMs = parseOptionalInteger(
    values["headers-timeout-ms"],
    "--headers-timeout-ms",
    0
  );
  const keepAliveTimeoutMs = parseOptionalInteger(
    values["keep-alive-timeout-ms"],
    "--keep-alive-timeout-ms",
    0
  );
  const shutdownGraceMs =
    parseOptionalInteger(values["shutdown-grace-ms"], "--shutdown-grace-ms", 0) ?? 10_000;

  return {
    help: values.help ?? false,
    version: values.version ?? false,
    port: parsePort(values.port),
    hostname: values.hostname ?? "127.0.0.1",
    path: values.path ?? "/mcp",
    stateless: values.stateless ?? false,
    jsonResponse: values["json-response"] ?? false,
    ...(Array.isArray(values["allowed-host"]) && values["allowed-host"].length > 0
      ? { allowedHosts: [...values["allowed-host"]] }
      : {}),
    ...(Array.isArray(values["allowed-origin"]) && values["allowed-origin"].length > 0
      ? {
          allowedOrigins: values["allowed-origin"].map((value) =>
            parseOrigin(value, "--allowed-origin")
          )
        }
      : {}),
    ...(maxRequestBytes === undefined ? {} : { maxRequestBytes }),
    ...(maxBatchSize === undefined ? {} : { maxBatchSize }),
    ...(maxSessions === undefined ? {} : { maxSessions }),
    ...(maxSessionsPerSubject === undefined ? {} : { maxSessionsPerSubject }),
    ...(sessionTtlMs === undefined ? {} : { sessionTtlMs }),
    ...(maxStreamsPerSession === undefined ? {} : { maxStreamsPerSession }),
    ...(maxStreamBufferBytes === undefined ? {} : { maxStreamBufferBytes }),
    ...(maxSseEventHistory === undefined ? {} : { maxSseEventHistory }),
    ...(sseKeepAliveMs === undefined ? {} : { sseKeepAliveMs }),
    ...(maxConcurrentToolCalls === undefined ? {} : { maxConcurrentToolCalls }),
    trustedProxy: values["trusted-proxy"] ?? false,
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    ...(headersTimeoutMs === undefined ? {} : { headersTimeoutMs }),
    ...(keepAliveTimeoutMs === undefined ? {} : { keepAliveTimeoutMs }),
    shutdownGraceMs,
    oauth: parseCliOAuthOptions(values)
  };
}

function listenForShutdownSignals(listener: () => void): () => void {
  process.on("SIGINT", listener);
  process.on("SIGTERM", listener);

  return () => {
    process.off("SIGINT", listener);
    process.off("SIGTERM", listener);
  };
}

function scheduleShutdownGrace(listener: () => void, graceMs: number): () => void {
  const timer = setTimeout(listener, graceMs);
  return () => clearTimeout(timer);
}

function waitForShutdown(
  shutdown: () => Promise<void>,
  forceShutdown: () => void,
  graceMs: number,
  listenForSignals: (listener: () => void) => () => void,
  scheduleGrace: (listener: () => void, graceMs: number) => () => void
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let shutdownStarted = false;
    let settled = false;
    let cancelGrace: () => void = () => undefined;
    let removeSignalListeners: () => void = () => undefined;

    const finish = (forced: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      cancelGrace();
      removeSignalListeners();
      resolve(forced);
    };
    const force = () => {
      if (settled) {
        return;
      }
      try {
        forceShutdown();
        finish(true);
      } catch {
        finish(true);
      }
    };
    const onSignal = () => {
      if (shutdownStarted) {
        force();
        return;
      }
      shutdownStarted = true;
      cancelGrace = scheduleGrace(force, graceMs);
      void shutdown().then(
        () => finish(false),
        (error) => {
          if (settled) {
            return;
          }
          settled = true;
          cancelGrace();
          removeSignalListeners();
          reject(error);
        }
      );
    };

    removeSignalListeners = listenForSignals(onSignal);
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
  const loadVerifier = dependencies.loadOAuthVerifier ?? loadOAuthVerifier;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const customWaitForShutdown = dependencies.waitForShutdown;
  const listenForSignals = dependencies.listenForShutdownSignals ?? listenForShutdownSignals;
  const scheduleGrace = dependencies.scheduleShutdownGrace ?? scheduleShutdownGrace;
  let handle: Awaited<ReturnType<HttpServer["listenHttp"]>> | undefined;
  let shutdownStarted = false;
  let options: ParsedCliArgs;

  try {
    options = parseCliOptions(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\nRun with --help for usage.\n`);
    return 1;
  }

  try {
    if (options.help) {
      stdout.write(`${HELP_TEXT}\n`);
      return 0;
    }
    if (options.version) {
      stdout.write(`${packageInfo.version}\n`);
      return 0;
    }

    const oauth =
      options.oauth === undefined
        ? undefined
        : {
            resource: options.oauth.resource,
            authorizationServers: options.oauth.authorizationServers,
            ...(options.oauth.requiredScopes !== undefined
              ? { requiredScopes: options.oauth.requiredScopes }
              : {}),
            ...(options.oauth.scopesSupported !== undefined
              ? { scopesSupported: options.oauth.scopesSupported }
              : {}),
            ...(options.oauth.bearerMethodsSupported !== undefined
              ? { bearerMethodsSupported: options.oauth.bearerMethodsSupported }
              : {}),
            verifier: await loadVerifier({
              modulePath: options.oauth.verifierModule,
              exportName: options.oauth.verifierExport
            })
          };

    const server = createServer({
      name: packageInfo.name,
      version: packageInfo.version,
      ...(options.stateless ? { sessionIdGenerator: undefined } : {}),
      ...(options.jsonResponse ? { enableJsonResponse: true } : {}),
      ...(options.allowedHosts === undefined ? {} : { allowedHosts: options.allowedHosts }),
      ...(options.allowedOrigins === undefined ? {} : { allowedOrigins: options.allowedOrigins }),
      ...(options.maxRequestBytes === undefined
        ? {}
        : { maxRequestBytes: options.maxRequestBytes }),
      ...(options.maxBatchSize === undefined ? {} : { maxBatchSize: options.maxBatchSize }),
      ...(options.maxSessions === undefined ? {} : { maxSessions: options.maxSessions }),
      ...(options.maxSessionsPerSubject === undefined ? {} : { maxSessionsPerSubject: options.maxSessionsPerSubject }),
      ...(options.sessionTtlMs === undefined ? {} : { sessionTtlMs: options.sessionTtlMs }),
      ...(options.maxStreamsPerSession === undefined
        ? {}
        : { maxStreamsPerSession: options.maxStreamsPerSession }),
      ...(options.maxStreamBufferBytes === undefined
        ? {}
        : { maxStreamBufferBytes: options.maxStreamBufferBytes }),
      ...(options.maxSseEventHistory === undefined
        ? {}
        : { maxSseEventHistory: options.maxSseEventHistory }),
      ...(options.sseKeepAliveMs === undefined ? {} : { sseKeepAliveMs: options.sseKeepAliveMs }),
      ...(options.maxConcurrentToolCalls === undefined
        ? {}
        : { maxConcurrentToolCalls: options.maxConcurrentToolCalls }),
      ...(options.trustedProxy ? { trustedProxy: true } : {}),
      ...(oauth === undefined ? {} : { oauth })
    });

    handle = await server.listenHttp({
      port: options.port,
      hostname: options.hostname,
      path: options.path,
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.headersTimeoutMs === undefined
        ? {}
        : { headersTimeoutMs: options.headersTimeoutMs }),
      ...(options.keepAliveTimeoutMs === undefined
        ? {}
        : { keepAliveTimeoutMs: options.keepAliveTimeoutMs })
    });

    const shutdown = async () => {
      shutdownStarted = true;
      await handle?.close();
    };
    const forceShutdown = () => {
      handle?.closeAllConnections();
    };
    const shutdownPromise =
      customWaitForShutdown === undefined
        ? waitForShutdown(
            shutdown,
            forceShutdown,
            options.shutdownGraceMs,
            listenForSignals,
            scheduleGrace
          )
        : undefined;

    stdout.write(`${handle.url}\n`);
    if (customWaitForShutdown === undefined) {
      const forced = await shutdownPromise;
      return forced ? 1 : 0;
    } else {
      await customWaitForShutdown(shutdown);
    }

    return 0;
  } catch (error) {
    if (handle !== undefined) {
      try {
        if (shutdownStarted) {
          handle.closeAllConnections();
        } else {
          await handle.close();
        }
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
