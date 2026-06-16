#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { readFile as readFileDefault } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Command, CommanderError } from 'commander';
import { startProxyServer as startProxyServerDefault } from './proxy-server.js';
import type { ProxyConfig, ProxyRoute, SnapshotMissBehavior } from './proxy-types.js';

const DEFAULT_ROUTE_TARGET = 'https://api.poe.com';

interface CliOptions {
  port?: string;
  capture?: string;
  route: string[];
  miss?: string;
  config?: string;
}

interface ParseProxyConfigDependencies {
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
}

interface RunProxyCliDependencies extends ParseProxyConfigDependencies {
  startProxyServer?: typeof startProxyServerDefault;
  stdout?: Pick<NodeJS.WriteStream, 'write'>;
  stderr?: Pick<NodeJS.WriteStream, 'write'>;
  waitForShutdown?: (shutdown: () => Promise<void>) => Promise<void>;
}

export function isCliInvocation(
  argv: string[],
  moduleUrl: string,
  realpath: (path: string) => string = realpathSync,
): boolean {
  const entry = argv.at(1);
  if (typeof entry !== 'string') {
    return false;
  }

  const candidates = [pathToFileURL(entry).href];
  try {
    candidates.push(pathToFileURL(realpath(entry)).href);
  } catch {
    // Ignore resolution errors and keep the direct candidate.
  }

  return candidates.includes(moduleUrl);
}

function isRouteMode(value: string): value is ProxyRoute['mode'] {
  return value === 'playback' || value === 'record';
}

function isOnMiss(value: string): value is SnapshotMissBehavior {
  return value === 'error' || value === 'warn' || value === 'passthrough' || value === 'record';
}

function parsePortFlag(value: string): number {
  if (!isPlainDecimalInteger(value)) {
    throw new Error('--port must be a decimal integer between 1 and 65535.');
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('--port must be a decimal integer between 1 and 65535.');
  }

  return port;
}

function isPlainDecimalInteger(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  if (value.length > 1 && value[0] === '0') {
    return false;
  }

  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 48 || code > 57) {
      return false;
    }
  }

  return true;
}

function parseRouteFlag(value: string): ProxyRoute {
  const equalsIndex = value.indexOf('=');
  const colonIndex = value.indexOf(':', equalsIndex + 1);

  if (
    equalsIndex <= 0 ||
    colonIndex <= equalsIndex + 1 ||
    colonIndex >= value.length - 1
  ) {
    throw new Error(
      "Invalid --route format. Expected '/path=mode:/snapshotDir'.",
    );
  }

  const path = value.slice(0, equalsIndex);
  const modeValue = value.slice(equalsIndex + 1, colonIndex);
  const snapshotDir = value.slice(colonIndex + 1);

  if (!isRouteMode(modeValue)) {
    throw new Error(`Invalid route mode: ${modeValue}`);
  }

  return {
    path,
    target: DEFAULT_ROUTE_TARGET,
    mode: modeValue,
    snapshotDir,
  };
}

function ensureString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Invalid proxy config: ${field} must be a string.`);
  }

  return value;
}

function ensurePort(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('Invalid proxy config: port must be an integer.');
  }

  if (value < 1 || value > 65535) {
    throw new Error('Invalid proxy config: port must be between 1 and 65535.');
  }

  return value;
}

function ensureOnMiss(value: unknown): SnapshotMissBehavior {
  if (value === undefined) {
    return 'error';
  }
  if (typeof value !== 'string' || !isOnMiss(value)) {
    throw new Error(
      'Invalid proxy config: onMiss must be one of error, warn, passthrough, or record.',
    );
  }

  return value;
}

function parseConfigRoute(routeValue: unknown, index: number): ProxyRoute {
  if (routeValue === null || typeof routeValue !== 'object') {
    throw new Error(`Invalid proxy config: routes[${index}] must be an object.`);
  }

  const routeRecord = routeValue as Record<string, unknown>;
  const modeValue = ensureString(routeRecord.mode, `routes[${index}].mode`);
  if (!isRouteMode(modeValue)) {
    throw new Error(`Invalid proxy config: routes[${index}].mode is unsupported.`);
  }

  const snapshotDirValue = routeRecord.snapshotDir;
  if (snapshotDirValue !== undefined && typeof snapshotDirValue !== 'string') {
    throw new Error(`Invalid proxy config: routes[${index}].snapshotDir must be a string.`);
  }

  return {
    path: ensureString(routeRecord.path, `routes[${index}].path`),
    target: ensureString(routeRecord.target, `routes[${index}].target`),
    mode: modeValue,
    ...(snapshotDirValue === undefined ? {} : { snapshotDir: snapshotDirValue }),
  };
}

function parseConfigJson(raw: string): ProxyConfig {
  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Invalid proxy config: expected top-level object.');
  }

  const configRecord = parsed as Record<string, unknown>;
  const routesValue = configRecord.routes;
  if (!Array.isArray(routesValue)) {
    throw new Error('Invalid proxy config: routes must be an array.');
  }

  return {
    port: ensurePort(configRecord.port),
    captureFile: ensureString(configRecord.captureFile, 'captureFile'),
    onMiss: ensureOnMiss(configRecord.onMiss),
    routes: routesValue.map((route, index) => parseConfigRoute(route, index)),
  };
}

function parseCliOptions(args: string[]): CliOptions {
  const command = new Command();
  command
    .name('proxy-server')
    .allowUnknownOption(false)
    .exitOverride()
    .option('--port <port>', 'Proxy listen port')
    .option('--capture <path>', 'Capture file path')
    .option(
      '--route <route>',
      "Route mapping '/path=mode:/snapshotDir' (repeatable)",
      (value, previous: string[]) => [...previous, value],
      [],
    )
    .option('--miss <behavior>', 'Snapshot miss behavior (error|warn|passthrough|record)')
    .option('--config <path>', 'Path to JSON proxy config');

  try {
    command.parse(args, { from: 'user' });
  } catch (error) {
    if (
      error instanceof CommanderError &&
      error.code === 'commander.helpDisplayed'
    ) {
      throw error;
    }

    if (error instanceof Error) {
      throw new Error(error.message);
    }
    throw error;
  }

  return command.opts<CliOptions>();
}

export async function parseProxyConfigFromArgs(
  args: string[],
  dependencies: ParseProxyConfigDependencies = {},
): Promise<ProxyConfig> {
  const options = parseCliOptions(args);
  const readFile = dependencies.readFile ?? readFileDefault;

  if (options.config) {
    if (options.port || options.capture || options.route.length > 0 || options.miss) {
      throw new Error(
        '--config cannot be combined with --port, --capture, --route, or --miss.',
      );
    }

    const configRaw = await readFile(options.config, 'utf8');
    return parseConfigJson(configRaw);
  }

  if (!options.port || !options.capture || options.route.length === 0) {
    throw new Error(
      'Missing required options: --port, --capture, and at least one --route.',
    );
  }

  const port = parsePortFlag(options.port);

  let onMiss: SnapshotMissBehavior = 'error';
  if (options.miss) {
    if (!isOnMiss(options.miss)) {
      throw new Error(`Invalid --miss value: ${options.miss}`);
    }
    onMiss = options.miss;
  }

  return {
    port,
    captureFile: options.capture,
    onMiss,
    routes: options.route.map((route) => parseRouteFlag(route)),
  };
}

export async function runProxyCli(
  args: string[] = process.argv.slice(2),
  dependencies: RunProxyCliDependencies = {},
): Promise<number> {
  const startProxyServer = dependencies.startProxyServer ?? startProxyServerDefault;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const waitForShutdown =
    dependencies.waitForShutdown ??
    ((shutdown: () => Promise<void>) =>
      new Promise<void>((resolve, reject) => {
        let closing = false;
        const onSignal = () => {
          if (closing) {
            return;
          }
          closing = true;
          void shutdown().then(resolve, reject);
        };

        process.once('SIGINT', onSignal);
        process.once('SIGTERM', onSignal);
      }));

  try {
    const config = await parseProxyConfigFromArgs(args, dependencies);
    const proxyServer = await startProxyServer(config);

    stdout.write(`Proxy server listening on ${proxyServer.url}\n`);

    await waitForShutdown(async () => {
      await proxyServer.close();
    });

    return 0;
  } catch (error) {
    if (
      error instanceof CommanderError &&
      error.code === 'commander.helpDisplayed'
    ) {
      return 0;
    }

    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }
}

if (isCliInvocation(process.argv, import.meta.url)) {
  runProxyCli().then((code) => process.exit(code));
}
