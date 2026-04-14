import { randomUUID } from 'node:crypto';
import { spawn as spawnAsync, spawnSync } from 'node:child_process';
import type {
  CapturedRequests,
  Container,
  ContainerOptions,
  ExecResult,
} from './types.js';
import { detectEngine } from './engine.js';
import { ensureImage } from './image.js';
import { getApiKey } from './credentials.js';
import { getResolvedContext, buildContextArgs } from './context.js';
import {
  MOUNT_TARGET,
  NPM_CACHE_DIR,
  UV_CACHE_DIR,
  getWorkspaceDir,
} from './container.js';
import { mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CapturedExchange } from './proxy-types.js';
import { CapturedRequests as CapturedRequestsCollection } from './proxy-requests.js';

const CONTAINER_LABEL = 'poe-e2e-test-runner=true';
export const CONTAINER_HOME = '/home/poe';
export const CONTAINER_PATH = `${CONTAINER_HOME}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`;
const PROXY_PORT = 3456;
const PROXY_BASE_URL = `http://localhost:${PROXY_PORT}`;
const PROXY_SNAPSHOT_DIR = '/tmp/proxy-snapshots';
const PROXY_CAPTURE_FILE = '/tmp/proxy-capture.jsonl';
const PROXY_ROUTE_PATH = '/v1/chat/completions';
const PROXY_BIND_MAX_ATTEMPTS = 200;
const PROXY_BIND_RETRY_DELAY_MS = 100;

import type { SnapshotMode, SnapshotMissBehavior } from './proxy-types.js';

function parseCapturedRequests(raw: string): CapturedRequests {
  const exchanges: CapturedExchange[] = [];
  for (const line of raw.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    exchanges.push(JSON.parse(line) as CapturedExchange);
  }
  return new CapturedRequestsCollection(exchanges);
}

function resolveSnapshotMode(value: string | undefined): SnapshotMode {
  const mode = value?.trim();
  if (!mode) {
    return 'playback';
  }
  if (mode === 'playback' || mode === 'record') {
    return mode;
  }
  throw new Error(
    `Unsupported POE_SNAPSHOT_MODE "${mode}". Use playback or record.`,
  );
}

function resolveOnMiss(value: string | undefined): SnapshotMissBehavior {
  const miss = value?.trim();
  if (!miss) {
    return 'error';
  }
  if (miss === 'error' || miss === 'warn' || miss === 'passthrough' || miss === 'record') {
    return miss;
  }
  throw new Error(
    `Unsupported POE_SNAPSHOT_MISS "${miss}". Use error, warn, passthrough, or record.`,
  );
}

function isSafeSnapshotKey(key: string): boolean {
  if (key.length === 0) {
    return false;
  }

  for (const char of key) {
    const code = char.charCodeAt(0);
    const isDigit = code >= 48 && code <= 57;
    const isUpper = code >= 65 && code <= 90;
    const isLower = code >= 97 && code <= 122;
    if (isDigit || isUpper || isLower || char === '-' || char === '_') {
      continue;
    }
    return false;
  }
  return true;
}

async function waitForProxyToBind(
  engine: string,
  ctxArgs: string[],
  containerId: string,
): Promise<void> {
  for (let attempt = 0; attempt < PROXY_BIND_MAX_ATTEMPTS; attempt += 1) {
    const probeResult = spawnSync(
      engine,
      [
        ...ctxArgs,
        'exec',
        containerId,
        'node',
        '-e',
        'fetch("http://127.0.0.1:3456/__health__").then(() => process.exit(0)).catch(() => process.exit(1));',
      ],
      {
        encoding: 'utf-8',
        stdio: 'pipe',
      },
    );

    if ((probeResult.status ?? 1) === 0) {
      return;
    }

    await new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, PROXY_BIND_RETRY_DELAY_MS);
    });
  }

  throw new Error(`Proxy did not bind on ${PROXY_BASE_URL} in time.`);
}

function ensureCacheDirs(): void {
  for (const dir of [NPM_CACHE_DIR, UV_CACHE_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

function generateContainerName(): string {
  return `poe-e2e-${randomUUID().split('-')[0]}`;
}

export function buildCreateArgs(config: {
  name: string;
  npmCacheDir: string;
  uvCacheDir: string;
  apiKey: string | null;
  proxyBaseUrl?: string | null;
  image: string;
}): string[] {
  const args: string[] = [
    'create',
    '--name', config.name,
    '--label', CONTAINER_LABEL,
    '-v', `${config.npmCacheDir}:${CONTAINER_HOME}/.npm:rw`,
    '-v', `${config.uvCacheDir}:${CONTAINER_HOME}/.cache/uv:rw`,
    '-w', MOUNT_TARGET,
  ];

  args.push('-e', `PATH=${CONTAINER_PATH}`);

  if (config.apiKey) {
    args.push('-e', 'POE_API_KEY');
    args.push('-e', 'POE_CODE_STDERR_LOGS=1');
  }

  if (config.proxyBaseUrl) {
    args.push('-e', `POE_BASE_URL=${config.proxyBaseUrl}`);
  }

  args.push(config.image, 'sleep', '86400');

  return args;
}

export function buildExecArgs(containerId: string, command: string): string[] {
  return ['exec', containerId, 'sh', '-c', command];
}

function execStreaming(engine: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnAsync(engine, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout!.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
      process.stderr.write(chunk);
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    });
  });
}

export const E2E_FIXTURES_DIR = '.snapshots';

export async function createContainer(options: ContainerOptions = {}): Promise<Container> {
  const useSnapshots = options.useSnapshots ?? false;
  if (useSnapshots && !options.testName) {
    throw new Error('useSnapshots requires testName');
  }

  const workspace = getWorkspaceDir() ?? process.cwd();
  ensureCacheDirs();
  const snapshotDir = useSnapshots && options.testName
    ? `${E2E_FIXTURES_DIR}/${options.testName}`
    : undefined;
  const hostSnapshotDir = snapshotDir ? resolve(workspace, snapshotDir) : null;
  const wantRecording = useSnapshots && (
    process.env.POE_SNAPSHOT_MODE === 'record' ||
    process.env.POE_SNAPSHOT_MISS === 'record'
  );
  if (hostSnapshotDir !== null && !existsSync(hostSnapshotDir) && wantRecording) {
    mkdirSync(hostSnapshotDir, { recursive: true });
  }
  const proxyEnabled = useSnapshots && hostSnapshotDir !== null && existsSync(hostSnapshotDir);
  const snapshotMode = proxyEnabled
    ? resolveSnapshotMode(process.env.POE_SNAPSHOT_MODE)
    : 'playback';
  const onMiss = proxyEnabled
    ? resolveOnMiss(process.env.POE_SNAPSHOT_MISS)
    : 'error';

  const engine = detectEngine();
  const context = getResolvedContext();
  const ctxArgs = buildContextArgs(engine, context);
  const image = options.image ?? ensureImage(engine, workspace, { context: context ?? undefined });
  const apiKey = await getApiKey();
  const name = generateContainerName();

  const createArgs = buildCreateArgs({
    name,
    npmCacheDir: NPM_CACHE_DIR,
    uvCacheDir: UV_CACHE_DIR,
    apiKey,
    proxyBaseUrl: proxyEnabled ? PROXY_BASE_URL : null,
    image,
  });

  const env = { ...process.env };
  if (apiKey) {
    env.POE_API_KEY = apiKey;
  }

  const createResult = spawnSync(engine, [...ctxArgs, ...createArgs], {
    encoding: 'utf-8',
    env,
  });

  if (createResult.status !== 0) {
    throw new Error(`Failed to create container: ${createResult.stderr}`);
  }

  const containerId = createResult.stdout.trim();

  const startResult = spawnSync(engine, [...ctxArgs, 'start', containerId], {
    encoding: 'utf-8',
  });

  if (startResult.status !== 0) {
    // Clean up the created container on start failure
    spawnSync(engine, [...ctxArgs, 'rm', '-f', containerId], { stdio: 'ignore' });
    throw new Error(`Failed to start container: ${startResult.stderr}`);
  }

  if (proxyEnabled) {
    const prepareProxyResult = spawnSync(
      engine,
      [...ctxArgs, 'exec', containerId, 'sh', '-c', `mkdir -p ${PROXY_SNAPSHOT_DIR} && : > ${PROXY_CAPTURE_FILE}`],
      { encoding: 'utf-8', stdio: 'pipe' },
    );
    if ((prepareProxyResult.status ?? 1) !== 0) {
      spawnSync(engine, [...ctxArgs, 'rm', '-f', containerId], { stdio: 'ignore' });
      throw new Error(`Failed to prepare proxy directories: ${(prepareProxyResult.stderr ?? '').trim()}`);
    }

    if (readdirSync(hostSnapshotDir).length > 0) {
      const copyResult = spawnSync(
        engine,
        [...ctxArgs, 'cp', `${hostSnapshotDir}/.`, `${containerId}:${PROXY_SNAPSHOT_DIR}/`],
        { encoding: 'utf-8', stdio: 'pipe' },
      );
      if ((copyResult.status ?? 1) !== 0) {
        spawnSync(engine, [...ctxArgs, 'rm', '-f', containerId], { stdio: 'ignore' });
        throw new Error(`Failed to copy snapshotDir into container: ${(copyResult.stderr ?? '').trim()}`);
      }
    }

    const proxyRoute = `${PROXY_ROUTE_PATH}=${snapshotMode}:${PROXY_SNAPSHOT_DIR}/`;
    const startProxyResult = spawnSync(
      engine,
      [
        ...ctxArgs,
        'exec',
        containerId,
        'sh',
        '-c',
        `nohup proxy-server --port ${PROXY_PORT} --capture ${PROXY_CAPTURE_FILE} --route '${proxyRoute}' --miss ${onMiss} >/tmp/proxy-server.log 2>&1 &`,
      ],
      { encoding: 'utf-8', stdio: 'pipe' },
    );
    if ((startProxyResult.status ?? 1) !== 0) {
      spawnSync(engine, [...ctxArgs, 'rm', '-f', containerId], { stdio: 'ignore' });
      throw new Error(`Failed to start proxy server: ${(startProxyResult.stderr ?? '').trim()}`);
    }

    try {
      await waitForProxyToBind(engine, ctxArgs, containerId);
    } catch (error) {
      spawnSync(engine, [...ctxArgs, 'rm', '-f', containerId], { stdio: 'ignore' });
      throw error;
    }
  }

  /** Always-quiet exec that never streams output (for internal helpers that may handle secrets) */
  const execQuiet = async (command: string): Promise<ExecResult> => {
    const execArgs = buildExecArgs(containerId, command);
    const fullArgs = [...ctxArgs, ...execArgs];
    const result = spawnSync(engine, fullArgs, {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return {
      exitCode: result.status ?? 1,
      stdout: (result.stdout ?? '').trim(),
      stderr: (result.stderr ?? '').trim(),
      command,
    };
  };

  const exec = async (command: string): Promise<ExecResult> => {
    const verbose = process.env.E2E_VERBOSE === '1';
    if (!verbose) {
      return execQuiet(command);
    }

    const execArgs = buildExecArgs(containerId, command);
    const fullArgs = [...ctxArgs, ...execArgs];
    const result = await execStreaming(engine, fullArgs);
    return { exitCode: result.exitCode, stdout: result.stdout.trim(), stderr: result.stderr.trim(), command };
  };

  const execOrThrow = async (command: string): Promise<ExecResult> => {
    const result = await exec(command);
    if (result.exitCode !== 0) {
      throw new Error(
        `Command failed: "${command}" (exit code ${result.exitCode})\n${result.stderr}`
      );
    }
    return result;
  };

  return {
    id: containerId,

    destroy: async () => {
      spawnSync(engine, [...ctxArgs, 'rm', '-f', containerId], { stdio: 'ignore' });
    },

    exec,

    execOrThrow,

    async login(): Promise<void> {
      if (!apiKey) {
        throw new Error('No API key available. Set POE_API_KEY environment variable.');
      }
      await execOrThrow('poe-code --yes login');
    },

    async fileExists(filePath: string): Promise<boolean> {
      const result = await execQuiet(`test -f ${filePath}`);
      return result.exitCode === 0;
    },

    async readFile(filePath: string): Promise<string> {
      const result = await execQuiet(`cat ${filePath}`);
      if (result.exitCode !== 0) {
        throw new Error(
          `Failed to read file "${filePath}": ${result.stderr}`
        );
      }
      return result.stdout;
    },

    async writeFile(filePath: string, content: string): Promise<void> {
      const result = spawnSync(engine, [...ctxArgs, 'exec', '-i', containerId, 'sh', '-c', `cat > ${filePath}`], {
        encoding: 'utf-8',
        input: content,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if ((result.status ?? 1) !== 0) {
        throw new Error(
          `Failed to write file "${filePath}": ${(result.stderr ?? '').trim()}`
        );
      }
    },

    async proxyLog() {
      if (!proxyEnabled) {
        return null;
      }
      const result = await execQuiet('cat /tmp/proxy-server.log');
      if (result.exitCode !== 0) {
        return null;
      }
      return result.stdout;
    },

    async requests() {
      if (!proxyEnabled) {
        throw new Error(`requests() requires ${E2E_FIXTURES_DIR}/<testName> directory to exist`);
      }
      const result = await execQuiet(`cat ${PROXY_CAPTURE_FILE}`);
      if (result.exitCode !== 0) {
        throw new Error(`Failed to read captured requests: ${result.stderr}`);
      }
      return parseCapturedRequests(result.stdout);
    },

    async writeSnapshots(snapshots: Array<{ key: string; response: unknown }>) {
      if (!proxyEnabled) {
        throw new Error(`writeSnapshots() requires ${E2E_FIXTURES_DIR}/<testName> directory to exist`);
      }

      for (const snapshot of snapshots) {
        if (!isSafeSnapshotKey(snapshot.key)) {
          throw new Error(`Invalid snapshot key "${snapshot.key}". Use only letters, numbers, "-" and "_".`);
        }
        const result = spawnSync(
          engine,
          [...ctxArgs, 'exec', '-i', containerId, 'sh', '-c', `cat > ${PROXY_SNAPSHOT_DIR}/${snapshot.key}.json`],
          {
            encoding: 'utf-8',
            input: JSON.stringify({
              key: snapshot.key,
              response: snapshot.response,
            }, null, 2),
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
        if ((result.status ?? 1) !== 0) {
          throw new Error(
            `Failed to write snapshot "${snapshot.key}": ${(result.stderr ?? '').trim()}`,
          );
        }
      }
    },
  };
}
