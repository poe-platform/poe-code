import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { resolveBackend, type Backend } from './backend.js';
import { detectEngine } from './engine.js';
import { hasApiKey } from './credentials.js';
import type { Engine } from './types.js';

const LABEL = 'poe-e2e-test-runner';

interface CheckResult {
  name: string;
  passed: boolean;
  message?: string;
  fix?: string;
}

export interface RunPreflightOptions {
  backend?: Backend;
  verbose?: boolean;
}

export async function runPreflight(
  options: RunPreflightOptions = {},
): Promise<{ passed: boolean; results: CheckResult[] }> {
  const results: CheckResult[] = [];
  const backend = options.backend ?? resolveBackend();

  if (backend === 'podman') {
    const engineCheck = checkPodmanInstalled();
    results.push(engineCheck);
    if (!engineCheck.passed) {
      return { passed: false, results };
    }

    const daemonCheck = checkPodmanRunning();
    results.push(daemonCheck);
    if (!daemonCheck.passed) {
      return { passed: false, results };
    }
  }

  if (backend === 'sandbox') {
    const sandboxCheck = checkSandboxRuntime();
    results.push(sandboxCheck);
    if (!sandboxCheck.passed) {
      return { passed: false, results };
    }
  }

  const apiKeyCheck = await checkApiKey();
  results.push(apiKeyCheck);
  if (!apiKeyCheck.passed) {
    return { passed: false, results };
  }

  if (backend === 'podman') {
    const cleaned = await cleanupOrphans('podman');
    if (cleaned > 0) {
      results.push({
        name: 'Cleanup',
        passed: true,
        message: `Cleaned up ${cleaned} orphaned container(s)`,
      });
    }
  }

  return { passed: true, results };
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

export async function cleanupOrphans(engine: Engine = 'podman'): Promise<number> {
  try {
    const output = execSync(
      `${engine} ps -aq --filter label=${LABEL}=true`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const containerIds = output.trim().split('\n').filter(Boolean);

    if (containerIds.length === 0) {
      return 0;
    }

    for (const id of containerIds) {
      try {
        execSync(`${engine} stop ${id}`, { stdio: 'ignore' });
      } catch {
        // Ignore errors.
      }
      try {
        execSync(`${engine} rm -f ${id}`, { stdio: 'ignore' });
      } catch {
        // Ignore errors.
      }
    }

    return containerIds.length;
  } catch {
    return 0;
  }
}

export function formatPreflightResults(results: CheckResult[]): string {
  const lines: string[] = [];
  lines.push(chalk.bold('Preflight checks:'));

  for (const result of results) {
    if (result.passed) {
      lines.push(`  ${chalk.green('✓')} ${result.name}${result.message ? chalk.dim(`: ${result.message}`) : ''}`);
    } else {
      lines.push(`  ${chalk.red.bold('✗')} ${chalk.red(result.name)}${result.message ? chalk.red(`: ${result.message}`) : ''}`);

      if (result.fix) {
        lines.push('');
        lines.push(chalk.yellow(result.fix));
      }
    }
  }

  return lines.join('\n');
}
