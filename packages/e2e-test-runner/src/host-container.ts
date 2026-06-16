import { spawn, spawnSync } from 'node:child_process';
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  lstat,
  readFile as readFileFs,
  readdir,
  rm,
  symlink,
  writeFile as writeFileFs,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { getWorkspaceDir } from './runtime.js';
import { getApiKey } from './credentials.js';
import { hasOwnErrorCode } from './error-codes.js';
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
  return hasOwnErrorCode(error, 'ENOTEMPTY') || hasOwnErrorCode(error, 'EBUSY');
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
  repoDir: string;
  server: ProxyServer | null;
  snapshotDir: string;
  enabled: boolean;
  onMiss: SnapshotMissBehavior;
  mode: SnapshotMode;
}

async function linkRootPackageBins(home: string, repoDir: string): Promise<void> {
  const localBinDir = join(home, '.local', 'bin');
  await mkdir(localBinDir, { recursive: true });

  let pkg: { name?: string; bin?: string | Record<string, string> };
  try {
    pkg = JSON.parse(await readFileFs(join(repoDir, 'package.json'), 'utf-8'));
  } catch {
    return;
  }

  const bins: Record<string, string> = typeof pkg.bin === 'string'
    ? { [pkg.name ?? '']: pkg.bin }
    : pkg.bin ?? {};

  for (const [name, relPath] of Object.entries(bins)) {
    if (!name) continue;
    if (basename(name) !== name) {
      throw new Error(`Invalid package bin name "${name}".`);
    }
    const target = resolve(repoDir, relPath);
    if (!isPathWithin(repoDir, target)) {
      throw new Error(`Package bin target "${relPath}" is outside the workspace.`);
    }
    try {
      if ((await lstat(target)).isSymbolicLink()) {
        throw new Error(`Package bin target "${relPath}" must not be a symbolic link.`);
      }
      await access(target);
      await chmod(target, 0o755);
      await symlink(target, join(localBinDir, name));
    } catch (error) {
      if (error instanceof Error && error.message.includes('symbolic link')) {
        throw error;
      }
      // skip bins whose targets don't exist (not built yet)
    }
  }
}

function isPathWithin(parentPath: string, candidatePath: string): boolean {
  const pathFromParent = relative(parentPath, candidatePath);
  return pathFromParent === '' || (
    pathFromParent !== '..' &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  );
}

function resolveContainerFilePath(filePath: string, home: string, workspace: string): string {
  const resolvedPath = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(workspace, filePath);
  const resolvedHome = resolve(home);
  const resolvedWorkspace = resolve(workspace);

  if (isPathWithin(resolvedHome, resolvedPath) || isPathWithin(resolvedWorkspace, resolvedPath)) {
    return resolvedPath;
  }

  throw new Error(
    `Refusing to access path outside the e2e container: ${filePath}`,
  );
}

async function resolveSnapshotDir(repoDir: string, testName: string): Promise<string> {
  if (basename(testName) !== testName || testName === '.' || testName === '..') {
    throw new Error(`Invalid snapshot test name "${testName}".`);
  }
  const snapshotsRoot = resolve(repoDir, E2E_FIXTURES_DIR);
  const snapshotDir = resolve(snapshotsRoot, testName);
  if (!isPathWithin(snapshotsRoot, snapshotDir)) {
    throw new Error(`Invalid snapshot test name "${testName}".`);
  }
  await assertSnapshotPathHasNoSymlink(repoDir, snapshotDir);
  return snapshotDir;
}

async function assertSnapshotPathHasNoSymlink(repoDir: string, snapshotDir: string): Promise<void> {
  let currentPath = resolve(repoDir);
  for (const segment of relative(currentPath, snapshotDir).split(sep).filter(Boolean)) {
    currentPath = join(currentPath, segment);
    try {
      if ((await lstat(currentPath)).isSymbolicLink()) {
        throw new Error(`Snapshot directory must not be a symbolic link: ${currentPath}`);
      }
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }
      throw error;
    }
  }
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, 'ENOENT');
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
    if (!hasOwnErrorCode(error, 'ENOENT')) {
      throw error;
    }
  }

  await linkRootPackageBins(home, repoDir);

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
    ? await resolveSnapshotDir(repoDir, options.testName)
    : null;
  const wantRecording = useSnapshots && (
    process.env.POE_SNAPSHOT_MODE === 'record' ||
    process.env.POE_SNAPSHOT_MISS === 'record'
  );

  if (snapshotDir !== null && wantRecording) {
    await assertSnapshotPathHasNoSymlink(repoDir, snapshotDir);
    await mkdir(snapshotDir, { recursive: true });
    await assertSnapshotPathHasNoSymlink(repoDir, snapshotDir);
  }

  let proxyState: ProxyState = {
    captureFile: join(home, PROXY_CAPTURE_FILE),
    enabled: useSnapshots && snapshotDir !== null,
    log: null,
    onMiss: useSnapshots ? resolveOnMiss(process.env.POE_SNAPSHOT_MISS) : 'error',
    mode: useSnapshots ? resolveSnapshotMode(process.env.POE_SNAPSHOT_MODE) : 'playback',
    repoDir,
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
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8'),
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
        await server.close();
        proxyState = {
          ...proxyState,
          log: null,
          server: null,
        };
      }
      await removeHomeDirectory(home);
    },

    exec,

    execOrThrow,

    async login() {
      return undefined;
    },

    async fileExists(filePath: string) {
      const safePath = resolveContainerFilePath(filePath, home, workspace);
      try {
        await access(safePath);
        return true;
      } catch {
        return false;
      }
    },

    async readFile(filePath: string) {
      return await readFileFs(
        resolveContainerFilePath(filePath, home, workspace),
        'utf-8',
      );
    },

    async writeFile(filePath: string, content: string) {
      await writeFileFs(
        resolveContainerFilePath(filePath, home, workspace),
        content,
      );
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

      await assertSnapshotPathHasNoSymlink(proxyState.repoDir, proxyState.snapshotDir);
      await mkdir(proxyState.snapshotDir, { recursive: true });
      await assertSnapshotPathHasNoSymlink(proxyState.repoDir, proxyState.snapshotDir);
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
