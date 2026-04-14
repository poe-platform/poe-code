import { spawn, spawnSync } from 'node:child_process';
import {
  access,
  mkdtemp,
  mkdir,
  readFile as readFileFs,
  readdir,
  rm,
  writeFile as writeFileFs,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { getWorkspaceDir } from './runtime.js';
import { getApiKey } from './credentials.js';
import { CapturedRequests as CapturedRequestsCollection } from './proxy-requests.js';
import { startProxyServer, type ProxyServer } from './proxy-server.js';
import type { CapturedExchange, SnapshotMissBehavior, SnapshotMode } from './proxy-types.js';
import type { CapturedRequests, Container, ContainerOptions, ExecResult } from './types.js';

const TEMP_HOME_PREFIX = join(tmpdir(), 'poe-e2e-');
const E2E_FIXTURES_DIR = '.snapshots';
const PROXY_ROUTE_PATH = '/v1/chat/completions';
const PROXY_ROUTE_TARGET = 'https://api.poe.com';
const PROXY_CAPTURE_FILE = 'proxy-capture.jsonl';
const REMOVE_HOME_MAX_ATTEMPTS = 4;
const REMOVE_HOME_RETRY_DELAY_MS = 250;

export interface HostExecCommand {
  bin: string;
  args: string[];
}

export interface HostExecCommandContext {
  command: string;
  env: NodeJS.ProcessEnv;
  home: string;
  workspace: string;
}

export type HostExecCommandBuilder = (context: HostExecCommandContext) => HostExecCommand;

function isRetryableRemoveError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return error.code === 'ENOTEMPTY' || error.code === 'EBUSY';
}

function killProcessesUsingHome(home: string): void {
  try {
    const output = spawnSync('lsof', ['+D', home], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    if (!output.stdout) return;

    const pids = new Set<number>();
    for (const line of output.stdout.split('\n').slice(1)) {
      const pid = parseInt(line.split(/\s+/)[1], 10);
      if (pid > 0 && pid !== process.pid) {
        pids.add(pid);
      }
    }

    for (const pid of pids) {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  } catch { /* lsof not available or failed */ }
}

async function removeHomeDirectory(home: string): Promise<void> {
  for (let attempt = 1; attempt <= REMOVE_HOME_MAX_ATTEMPTS; attempt += 1) {
    try {
      await rm(home, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isRetryableRemoveError(error) || attempt === REMOVE_HOME_MAX_ATTEMPTS) {
        throw error;
      }

      killProcessesUsingHome(home);
      await new Promise((resolve) => {
        setTimeout(resolve, REMOVE_HOME_RETRY_DELAY_MS * attempt);
      });
    }
  }
}

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

function commandExists(command: string, env: NodeJS.ProcessEnv, cwd: string): boolean {
  const result = spawnSync(command, ['--version'], {
    cwd,
    env,
    encoding: 'utf-8',
    stdio: 'pipe',
  });

  return result.status === 0;
}

function buildExecEnv(
  home: string,
  repoDir: string,
  apiKey: string,
  proxyBaseUrl?: string,
): NodeJS.ProcessEnv {
  const path = `${home}/.local/bin:${home}/.npm-global/bin:${repoDir}/node_modules/.bin:${process.env.PATH ?? ''}`;

  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: `${home}/.config`,
    NPM_CONFIG_PREFIX: `${home}/.npm-global`,
    PATH: path,
    POE_API_KEY: apiKey,
    ...(proxyBaseUrl ? { POE_BASE_URL: proxyBaseUrl } : {}),
  };
}

interface ProxyState {
  captureFile: string;
  log: string | null;
  server: ProxyServer | null;
  snapshotDir: string;
  enabled: boolean;
  onMiss: SnapshotMissBehavior;
  mode: SnapshotMode;
}

async function runPreflight(home: string, repoDir: string): Promise<string> {
  const homeEntries = await readdir(home).then(
    entries => entries.filter(e => e !== 'workspace'),
  );
  if (homeEntries.length !== 0) {
    throw new Error(`Expected fresh HOME to be empty, found: ${homeEntries.join(', ')}`);
  }

  try {
    await access(join(home, '.config'));
    throw new Error('Expected fresh HOME to have no agent config directories yet.');
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('No API key available. Set POE_API_KEY environment variable.');
  }

  const env = buildExecEnv(home, repoDir, apiKey);
  for (const command of ['node', 'npm', 'uv']) {
    if (!commandExists(command, env, repoDir)) {
      throw new Error(`Required tool "${command}" is not available on PATH.`);
    }
  }

  return apiKey;
}

async function startProxy(state: ProxyState): Promise<ProxyState> {
  if (!state.enabled || state.server !== null) {
    return state;
  }

  await writeFileFs(state.captureFile, '');
  const server = await startProxyServer({
    port: 0,
    captureFile: state.captureFile,
    onMiss: state.onMiss,
    routes: [
      {
        path: PROXY_ROUTE_PATH,
        target: PROXY_ROUTE_TARGET,
        mode: state.mode,
        snapshotDir: state.snapshotDir,
      },
    ],
  });

  return {
    ...state,
    server,
    log: `Proxy server listening on ${server.url}`,
  };
}

export async function createHostContainer(
  options: ContainerOptions = {},
  buildExecCommand: HostExecCommandBuilder,
): Promise<Container> {
  const useSnapshots = options.useSnapshots ?? false;
  if (useSnapshots && !options.testName) {
    throw new Error('useSnapshots requires testName');
  }

  const home = await mkdtemp(TEMP_HOME_PREFIX);
  const workspace = join(home, 'workspace');
  await mkdir(workspace, { recursive: true });
  const repoDir = getWorkspaceDir() ?? process.cwd();
  const snapshotDir = useSnapshots && options.testName
    ? resolve(repoDir, E2E_FIXTURES_DIR, options.testName)
    : null;
  const wantRecording = useSnapshots && (
    process.env.POE_SNAPSHOT_MODE === 'record' ||
    process.env.POE_SNAPSHOT_MISS === 'record'
  );

  if (snapshotDir !== null && wantRecording) {
    await mkdir(snapshotDir, { recursive: true });
  }

  let proxyState: ProxyState = {
    captureFile: join(home, PROXY_CAPTURE_FILE),
    enabled: useSnapshots && snapshotDir !== null,
    log: null,
    onMiss: useSnapshots ? resolveOnMiss(process.env.POE_SNAPSHOT_MISS) : 'error',
    mode: useSnapshots ? resolveSnapshotMode(process.env.POE_SNAPSHOT_MODE) : 'playback',
    server: null,
    snapshotDir: snapshotDir ?? '',
  };
  let apiKey: string | null = null;
  let preflightComplete = false;

  async function ensureReady(): Promise<{
    apiKey: string;
    env: NodeJS.ProcessEnv;
  }> {
    if (!preflightComplete) {
      apiKey = await runPreflight(home, repoDir);
      preflightComplete = true;
    }
    if (!apiKey) {
      throw new Error('No API key available. Set POE_API_KEY environment variable.');
    }

    proxyState = await startProxy(proxyState);

    return {
      apiKey,
      env: buildExecEnv(
        home,
        repoDir,
        apiKey,
        proxyState.server?.url,
      ),
    };
  }

  const exec = async (command: string): Promise<ExecResult> => {
    const { env } = await ensureReady();
    const execCommand = buildExecCommand({
      command,
      env,
      home,
      workspace,
    });

    return await new Promise<ExecResult>((resolvePromise, reject) => {
      const child = spawn(execCommand.bin, execCommand.args, {
        cwd: workspace,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout!.on('data', (chunk: Buffer | string) => {
        stdoutChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });
      child.stderr!.on('data', (chunk: Buffer | string) => {
        stderrChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      });
      child.on('error', reject);
      child.on('close', (code) => {
        resolvePromise({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdoutChunks).toString('utf-8').trim(),
          stderr: Buffer.concat(stderrChunks).toString('utf-8').trim(),
          command,
        });
      });
    });
  };

  const execOrThrow = async (command: string): Promise<ExecResult> => {
    const result = await exec(command);
    if (result.exitCode !== 0) {
      throw new Error(
        `Command failed: "${command}" (exit code ${result.exitCode})\n${result.stderr}`,
      );
    }
    return result;
  };

  return {
    id: basename(home),
    home,
    workspace,

    async destroy() {
      if (proxyState.server !== null) {
        const server = proxyState.server;
        proxyState = {
          ...proxyState,
          log: null,
          server: null,
        };
        await server.close();
      }
      await removeHomeDirectory(home);
    },

    exec,

    execOrThrow,

    async login() {
      return undefined;
    },

    async fileExists(filePath: string) {
      try {
        await access(filePath);
        return true;
      } catch {
        return false;
      }
    },

    async readFile(filePath: string) {
      return await readFileFs(filePath, 'utf-8');
    },

    async writeFile(filePath: string, content: string) {
      await writeFileFs(filePath, content);
    },

    async proxyLog() {
      return proxyState.log;
    },

    async requests() {
      if (!proxyState.enabled) {
        throw new Error(`requests() requires ${E2E_FIXTURES_DIR}/<testName> directory to exist`);
      }

      if (proxyState.server === null) {
        return parseCapturedRequests('');
      }

      const raw = await readFileFs(proxyState.captureFile, 'utf-8');
      return parseCapturedRequests(raw);
    },

    async writeSnapshots(snapshots: Array<{ key: string; response: unknown }>) {
      if (!proxyState.enabled) {
        throw new Error(`writeSnapshots() requires ${E2E_FIXTURES_DIR}/<testName> directory to exist`);
      }

      await mkdir(proxyState.snapshotDir, { recursive: true });
      for (const snapshot of snapshots) {
        if (!isSafeSnapshotKey(snapshot.key)) {
          throw new Error(`Invalid snapshot key "${snapshot.key}". Use only letters, numbers, "-" and "_".`);
        }

        await writeFileFs(
          join(proxyState.snapshotDir, `${snapshot.key}.json`),
          JSON.stringify(
            {
              key: snapshot.key,
              response: snapshot.response,
            },
            null,
            2,
          ),
        );
      }
    },
  };
}
