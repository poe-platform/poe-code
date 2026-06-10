import { execSync } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { color } from 'toolcraft-design';
import { resolveBackend, type Backend } from './backend.js';
import { hasApiKey } from './credentials.js';
import { detectEngine } from './engine.js';
import { hasOwnErrorCode } from './error-codes.js';
import { getWorkspaceDir } from './runtime.js';
import type { Engine } from './types.js';

const LABEL = 'poe-e2e-test-runner';
const TEMP_HOME_PREFIX = join(tmpdir(), 'poe-e2e-');

interface CheckResult {
  name: string;
  passed: boolean;
  message?: string;
  fix?: string;
}

interface IsolatedHostContext {
  home: string;
  workspace: string;
  env: NodeJS.ProcessEnv;
}

interface OrphanCleanupResult {
  found: number;
  removed: number;
}

export interface RunPreflightOptions {
  backend?: Backend;
  verbose?: boolean;
}

export interface PreflightEnvironment {
  backend: Backend;
  workspace: string;
  home: string;
}

export async function runPreflight(
  options: RunPreflightOptions = {},
): Promise<{ passed: boolean; results: CheckResult[]; environment: PreflightEnvironment }> {
  const results: CheckResult[] = [];
  const backend = options.backend ?? resolveBackend();
  const home = join(tmpdir(), 'poe-e2e-<id>');
  const workspace = join(home, 'workspace');
  const environment: PreflightEnvironment = { backend, workspace, home };

  if (backend === 'podman') {
    const engineCheck = checkPodmanInstalled();
    results.push(engineCheck);
    if (!engineCheck.passed) {
      return { passed: false, results, environment };
    }

    const daemonCheck = checkPodmanRunning();
    results.push(daemonCheck);
    if (!daemonCheck.passed) {
      return { passed: false, results, environment };
    }
  }

  if (backend === 'sandbox') {
    const sandboxCheck = checkSandboxRuntime();
    results.push(sandboxCheck);
    if (!sandboxCheck.passed) {
      return { passed: false, results, environment };
    }
  }

  const apiKeyCheck = await checkApiKey();
  results.push(apiKeyCheck);
  if (!apiKeyCheck.passed) {
    return { passed: false, results, environment };
  }

  if (backend === 'env' || backend === 'sandbox') {
    const isolatedChecks = await runIsolatedHostChecks();
    results.push(isolatedChecks.agentCheck);
    if (!isolatedChecks.agentCheck.passed) {
      return { passed: false, results, environment };
    }

    results.push(isolatedChecks.toolsCheck);
    if (!isolatedChecks.toolsCheck.passed) {
      return { passed: false, results, environment };
    }
  }

  if (backend === 'podman') {
    const cleaned = await cleanupOrphans('podman');
    if (cleaned.removed < cleaned.found) {
      results.push({
        name: 'Cleanup',
        passed: false,
        message: `Removed ${cleaned.removed} of ${cleaned.found} orphaned container(s)`,
      });
      return { passed: false, results, environment };
    }
    if (cleaned.removed > 0) {
      results.push({
        name: 'Cleanup',
        passed: true,
        message: `Cleaned up ${cleaned.removed} orphaned container(s)`,
      });
    }
  }

  return { passed: true, results, environment };
}

function checkPodmanInstalled(): CheckResult {
  try {
    const engine = detectEngine();
    if (engine !== 'podman') {
      throw new Error('Podman not installed');
    }
    return { name: 'Podman installed', passed: true };
  } catch (error) {
    return {
      name: 'Podman installed',
      passed: false,
      message: error instanceof Error ? error.message : 'Podman not installed',
      fix: 'Install Podman: https://podman.io/docs/installation',
    };
  }
}

function checkPodmanRunning(): CheckResult {
  try {
    execSync('podman info', { stdio: 'ignore' });
    return { name: 'Podman daemon running', passed: true };
  } catch {
    return {
      name: 'Podman daemon running',
      passed: false,
      message: 'Podman daemon not running',
      fix: 'Start Podman and verify `podman info` succeeds.',
    };
  }
}

function checkSandboxRuntime(): CheckResult {
  try {
    if (process.platform === 'darwin') {
      execSync('sandbox-exec -V', { stdio: 'ignore' });
      return { name: 'Sandbox runtime available', passed: true };
    }

    if (process.platform === 'linux') {
      execSync('bwrap --version', { stdio: 'ignore' });
      return { name: 'Sandbox runtime available', passed: true };
    }

    return {
      name: 'Sandbox runtime available',
      passed: false,
      message: `Sandbox backend is not supported on ${process.platform}`,
      fix: 'Use E2E_BACKEND=env or E2E_BACKEND=podman on this platform.',
    };
  } catch {
    return {
      name: 'Sandbox runtime available',
      passed: false,
      message: 'Sandbox runtime not available',
      fix:
        process.platform === 'darwin'
          ? 'sandbox-exec is required for the sandbox backend on macOS.'
          : 'bubblewrap (`bwrap`) is required for the sandbox backend on Linux.',
    };
  }
}

async function runIsolatedHostChecks(): Promise<{
  agentCheck: CheckResult;
  toolsCheck: CheckResult;
}> {
  return withIsolatedHostContext(async (context) => {
    const agentCheck = await checkAgentNotConfigured(context.home);
    if (!agentCheck.passed) {
      return {
        agentCheck,
        toolsCheck: {
          name: 'node/npm/uv on PATH',
          passed: false,
          message: 'Skipped because the isolated HOME is already configured.',
        },
      };
    }

    return {
      agentCheck,
      toolsCheck: checkRequiredToolsOnPath(context),
    };
  });
}

async function withIsolatedHostContext<T>(
  callback: (context: IsolatedHostContext) => Promise<T>,
): Promise<T> {
  const home = await mkdtemp(TEMP_HOME_PREFIX);
  const workspace = getWorkspaceDir() ?? process.cwd();
  const env = buildIsolatedHostEnv(home, workspace);

  try {
    return await callback({ home, workspace, env });
  } finally {
    try {
      await rm(home, { recursive: true, force: true });
    } catch {
      // Ignore temp HOME cleanup failures during preflight.
    }
  }
}

function buildIsolatedHostEnv(home: string, workspace: string): NodeJS.ProcessEnv {
  const path = `${home}/.local/bin:${home}/.npm-global/bin:${workspace}/node_modules/.bin:${process.env.PATH ?? ''}`;

  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: `${home}/.config`,
    NPM_CONFIG_PREFIX: `${home}/.npm-global`,
    PATH: path,
  };
}

async function checkAgentNotConfigured(home: string): Promise<CheckResult> {
  try {
    await access(join(home, '.config'));
    return {
      name: 'Agent not configured',
      passed: false,
      message: 'Fresh HOME already contains agent config directories.',
      fix: 'Use a fresh HOME directory for env and sandbox backends.',
    };
  } catch (error) {
    if (hasOwnErrorCode(error, 'ENOENT')) {
      return { name: 'Agent not configured', passed: true };
    }

    return {
      name: 'Agent not configured',
      passed: false,
      message: error instanceof Error ? error.message : 'Unable to verify agent config state.',
      fix: 'Ensure the isolated HOME directory is accessible and starts empty.',
    };
  }
}

function checkRequiredToolsOnPath(context: IsolatedHostContext): CheckResult {
  for (const command of ['node', 'npm', 'uv']) {
    try {
      execSync(`${command} --version`, {
        cwd: context.workspace,
        env: context.env,
        stdio: 'ignore',
      });
    } catch {
      return {
        name: 'node/npm/uv on PATH',
        passed: false,
        message: `Required tool "${command}" is not available on PATH.`,
        fix: 'Install node, npm, and uv, then make sure they are available on PATH.',
      };
    }
  }

  return { name: 'node/npm/uv on PATH', passed: true };
}

async function checkApiKey(): Promise<CheckResult> {
  if (await hasApiKey()) {
    return { name: 'API key available', passed: true };
  }
  return {
    name: 'API key available',
    passed: false,
    message: 'API key not available',
    fix:
      'Set an API key:\n' +
      '  - Environment: export POE_API_KEY=<your-key>\n' +
      '  - Or login: poe-code login',
  };
}

export async function cleanupOrphans(engine: Engine = 'podman'): Promise<OrphanCleanupResult> {
  try {
    const output = execSync(
      `${engine} ps -aq --filter label=${LABEL}=true`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const containerIds = output.trim().split('\n').filter(Boolean);

    if (containerIds.length === 0) {
      return { found: 0, removed: 0 };
    }

    let removed = 0;
    for (const id of containerIds) {
      try {
        execSync(`${engine} stop ${id}`, { stdio: 'ignore' });
      } catch {
        // Ignore errors.
      }
      try {
        execSync(`${engine} rm -f ${id}`, { stdio: 'ignore' });
        removed += 1;
      } catch {
        // Ignore errors.
      }
    }

    return { found: containerIds.length, removed };
  } catch {
    return { found: 0, removed: 0 };
  }
}

export function formatPreflightResults(results: CheckResult[], environment?: PreflightEnvironment): string {
  const lines: string[] = [];

  if (environment) {
    lines.push(color.bold('Environment:'));
    lines.push(`  backend:   ${color.cyan(environment.backend)}`);
    lines.push(`  workspace: ${color.cyan(environment.workspace)}`);
    lines.push(`  home:      ${color.cyan(environment.home)}`);
    lines.push('');
  }

  lines.push(color.bold('Preflight checks:'));

  for (const result of results) {
    if (result.passed) {
      lines.push(`  ${color.green('✓')} ${result.name}${result.message ? color.dim(`: ${result.message}`) : ''}`);
    } else {
      lines.push(`  ${color.red.bold('✗')} ${color.red(result.name)}${result.message ? color.red(`: ${result.message}`) : ''}`);

      if (result.fix) {
        lines.push('');
        lines.push(color.yellow(result.fix));
      }
    }
  }

  return lines.join('\n');
}
