import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { Engine } from './types.js';
import { detectEngine } from './engine.js';
import { getApiKey } from './credentials.js';

export const DEFAULT_IMAGE = 'node:22';
export const MOUNT_TARGET = '/workspace';

// Cache directories
export const E2E_CACHE_ROOT = join(homedir(), '.cache', 'poe-e2e');
export const NPM_CACHE_DIR = join(E2E_CACHE_ROOT, 'root-npm');
export const UV_CACHE_DIR = join(E2E_CACHE_ROOT, 'root-cache-uv');
export const LOCAL_BIN_DIR = join(E2E_CACHE_ROOT, 'root-local');

let workspaceDir: string | null = null;

export function setWorkspaceDir(dir: string): void {
  workspaceDir = dir;
}

export function getWorkspaceDir(): string | null {
  return workspaceDir;
}

function ensureCacheDirs(): void {
  for (const dir of [NPM_CACHE_DIR, UV_CACHE_DIR, LOCAL_BIN_DIR]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export interface ColimaProfile {
  name?: string;
  profile?: string;
  status: string;
  runtime?: string;
}

/** Parse colima list --json output (one JSON object per line) */
export function parseColimaOutput(output: string): ColimaProfile[] {
  return output.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function getColimaProfiles(): ColimaProfile[] {
  try {
    const output = execSync('colima list --json', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    return parseColimaOutput(output);
  } catch {
    return [];
  }
}

export interface ProfileMatch {
  profile: string;
  context: string;
  mountTarget: string;
}

/** Find a running colima profile suitable for the workspace */
export function findMatchingProfile(profiles: ColimaProfile[], workspace: string): ProfileMatch | null {
  const repoBasename = basename(workspace);
  const expectedProfile = `${repoBasename}-runner`;

  // First look for our expected profile
  for (const p of profiles) {
    const name = p.name || p.profile || 'default';
    if (name === expectedProfile && p.status === 'Running' && p.runtime === 'docker') {
      return {
        profile: name,
        context: name === 'default' ? 'colima' : `colima-${name}`,
        mountTarget: MOUNT_TARGET,
      };
    }
  }

  // Fall back to any running docker profile
  for (const p of profiles) {
    const name = p.name || p.profile || 'default';
    if (p.status === 'Running' && p.runtime === 'docker') {
      return {
        profile: name,
        context: name === 'default' ? 'colima' : `colima-${name}`,
        mountTarget: MOUNT_TARGET,
      };
    }
  }

  return null;
}

function findRunningColimaProfile(workspace: string): ProfileMatch | null {
  const profiles = getColimaProfiles();
  return findMatchingProfile(profiles, workspace);
}

function startColimaWithMount(workspace: string): { profile: string; context: string; mountTarget: string } {
  const repoBasename = basename(workspace);
  const profile = `${repoBasename}-runner`;

  console.log(`Starting colima profile '${profile}'...`);
  execSync(`colima start --profile "${profile}" --activate=false --mount "${workspace}:${MOUNT_TARGET}:w"`, {
    stdio: 'inherit',
  });

  // Wait for mount to be available
  for (let i = 0; i < 10; i++) {
    try {
      execSync(`colima ssh --profile "${profile}" -- test -f "${MOUNT_TARGET}/package.json"`, { stdio: 'ignore' });
      return {
        profile,
        context: `colima-${profile}`,
        mountTarget: MOUNT_TARGET,
      };
    } catch {
      execSync('sleep 1');
    }
  }

  throw new Error(`Colima mount not available after starting profile '${profile}'`);
}

function getDockerContext(): string {
  try {
    return execSync('docker context show', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

interface RunConfig {
  engine: Engine;
  context: string;
  mountSource: string;
}

function setupRunConfig(workspace: string): RunConfig {
  const engine = detectEngine();
  const dockerContext = getDockerContext();

  // Check if using Colima
  if (dockerContext.startsWith('colima') || engine === 'podman') {
    // Try to find running profile
    const running = findRunningColimaProfile(workspace);
    if (running) {
      // Verify mount works
      try {
        execSync(`colima ssh --profile "${running.profile}" -- test -f "${MOUNT_TARGET}/package.json"`, { stdio: 'ignore' });
        return { engine, context: running.context, mountSource: MOUNT_TARGET };
      } catch {
        // Mount not working, need to restart
      }
    }

    // Start colima with mount
    const started = startColimaWithMount(workspace);
    return { engine, context: started.context, mountSource: MOUNT_TARGET };
  }

  // Not using Colima - direct mount
  return { engine, context: '', mountSource: workspace };
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Build the shell script that runs inside the container */
export function buildContainerScript(commands: string[]): string {
  return [
    'set -e',
    `workspace_dir="${MOUNT_TARGET}"`,
    'build_dir=$(mktemp -d)',
    'cleanup_build_dir() { rm -rf "$build_dir"; }',
    'trap cleanup_build_dir EXIT',
    // Clean up /root except cached dirs
    'find /root -mindepth 1 -maxdepth 1 ! -name ".npm" ! -name ".cache" ! -name ".local" -exec rm -rf {} + 2>/dev/null || true',
    'mkdir -p /root/.poe-code/logs',
    // Install uv if not cached
    'command -v uv >/dev/null 2>&1 || curl -LsSf https://astral.sh/uv/install.sh | sh -s -- --quiet',
    '[ -f $HOME/.local/bin/env ] && . $HOME/.local/bin/env || true',
    // Add common paths to PATH
    'export PATH="$HOME/.local/bin:$HOME/.claude/local/bin:$PATH"',
    // Copy workspace, build, install
    'tar -C "$workspace_dir" --exclude=node_modules --exclude=.git -cf - . | tar -C "$build_dir" -xf -',
    'cd "$build_dir"',
    'npm install',
    'npm run build',
    'npm install -g .',
    'cd "$workspace_dir"',
    // Now run the actual commands
    ...commands,
  ].join('; ');
}

export interface CacheConfig {
  npmCacheDir: string;
  uvCacheDir: string;
  localBinDir: string;
}

export interface DockerArgsConfig {
  engine: Engine;
  context: string;
  mountSource: string;
  cacheConfig: CacheConfig;
  apiKey: string | null;
  containerScript: string;
}

/** Build docker command arguments */
export function buildDockerArgs(config: DockerArgsConfig): string[] {
  const args: string[] = [];

  if (config.context && config.engine === 'docker') {
    args.push('--context', config.context);
  }

  args.push(
    'run', '--rm',
    '-v', `${config.mountSource}:${MOUNT_TARGET}:rw`,
    '-v', `${config.cacheConfig.npmCacheDir}:/root/.npm:rw`,
    '-v', `${config.cacheConfig.uvCacheDir}:/root/.cache/uv:rw`,
    '-v', `${config.cacheConfig.localBinDir}:/root/.local:rw`,
    '-w', MOUNT_TARGET,
  );

  if (config.apiKey) {
    args.push('-e', 'POE_API_KEY');
    args.push('-e', 'POE_CODE_STDERR_LOGS=1');
  }

  args.push(DEFAULT_IMAGE, 'sh', '-lc', config.containerScript);

  return args;
}

/**
 * Run commands in a fresh container.
 * All setup and commands run in ONE docker run invocation.
 */
export function runInContainer(commands: string[], options: { verbose?: boolean } = {}): RunResult {
  const workspace = workspaceDir ?? process.cwd();
  ensureCacheDirs();

  const runConfig = setupRunConfig(workspace);
  const apiKey = getApiKey();
  const containerScript = buildContainerScript(commands);

  const dockerArgs = buildDockerArgs({
    engine: runConfig.engine,
    context: runConfig.context,
    mountSource: runConfig.mountSource,
    cacheConfig: {
      npmCacheDir: NPM_CACHE_DIR,
      uvCacheDir: UV_CACHE_DIR,
      localBinDir: LOCAL_BIN_DIR,
    },
    apiKey,
    containerScript,
  });

  const env = { ...process.env };
  if (apiKey) {
    env.POE_API_KEY = apiKey;
  }

  const result = spawnSync(runConfig.engine, dockerArgs, {
    env,
    stdio: options.verbose ? 'inherit' : 'pipe',
    encoding: 'utf-8',
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}
