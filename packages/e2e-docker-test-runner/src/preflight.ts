import { execSync } from 'node:child_process';
import chalk from 'chalk';
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

export async function runPreflight(): Promise<{ passed: boolean; results: CheckResult[] }> {
  const results: CheckResult[] = [];

  // Check 1: Docker/Podman installed
  const engineCheck = checkEngineInstalled();
  results.push(engineCheck);
  if (!engineCheck.passed) {
    return { passed: false, results };
  }

  const engine = detectEngine();

  // Check 2: Docker daemon running
  const daemonCheck = checkDaemonRunning(engine);
  results.push(daemonCheck);
  if (!daemonCheck.passed) {
    return { passed: false, results };
  }

  // Check 3: API key available
  const apiKeyCheck = checkApiKey();
  results.push(apiKeyCheck);
  if (!apiKeyCheck.passed) {
    return { passed: false, results };
  }

  // Cleanup orphan containers
  const cleaned = await cleanupOrphans(engine);
  if (cleaned > 0) {
    results.push({
      name: 'Cleanup',
      passed: true,
      message: `Cleaned up ${cleaned} orphaned container(s)`,
    });
  }

  return { passed: true, results };
}

function checkEngineInstalled(): CheckResult {
  try {
    detectEngine();
    return { name: 'Docker installed', passed: true };
  } catch {
    return {
      name: 'Docker installed',
      passed: false,
      message: 'Docker not installed',
      fix:
        'Install Docker:\n' +
        '  - Docker Desktop: https://www.docker.com/products/docker-desktop\n' +
        '  - Colima (macOS): brew install colima && colima start\n' +
        '  - Podman: https://podman.io/docs/installation',
    };
  }
}

function findRunningColimaContext(): string | null {
  try {
    // Check for any running colima profiles (output is one JSON object per line)
    const output = execSync('colima list --json', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = output.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const profile = JSON.parse(line);
      if (profile.status === 'Running' && profile.runtime === 'docker') {
        const name = profile.name || profile.profile;
        return name === 'default' ? 'colima' : `colima-${name}`;
      }
    }
  } catch {
    // colima not installed or list failed
  }
  return null;
}

function checkDaemonRunning(engine: Engine): CheckResult {
  // First check if there's a running colima profile we should use
  const runningContext = findRunningColimaContext();
  if (runningContext && engine === 'docker') {
    try {
      execSync(`${engine} --context ${runningContext} info`, { stdio: 'ignore' });
      return { name: 'Docker daemon running', passed: true, message: `Using ${runningContext}` };
    } catch {
      // Fall through to other checks
    }
  }

  try {
    execSync(`${engine} info`, { stdio: 'ignore' });
    return { name: 'Docker daemon running', passed: true };
  } catch {
    // Try to auto-start colima if available
    if (tryStartColima()) {
      try {
        execSync(`${engine} info`, { stdio: 'ignore' });
        return { name: 'Docker daemon running', passed: true, message: 'Started colima' };
      } catch {
        // Still failed after starting colima
      }
    }

    return {
      name: 'Docker daemon running',
      passed: false,
      message: 'Docker daemon not running',
      fix:
        'Start the Docker daemon:\n' +
        '  - Colima: colima start\n' +
        '  - Docker Desktop: open -a Docker',
    };
  }
}

function tryStartColima(): boolean {
  try {
    // Check if colima is installed
    execSync('command -v colima', { stdio: 'ignore' });

    // Check if colima is already running
    try {
      execSync('colima status', { stdio: 'ignore' });
      return true; // Already running
    } catch {
      // Not running, try to start
      console.log(chalk.dim('Starting colima...'));
      execSync('colima start', { stdio: 'inherit', timeout: 120000 });
      return true;
    }
  } catch {
    return false;
  }
}

function checkApiKey(): CheckResult {
  if (hasApiKey()) {
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

export async function cleanupOrphans(engine?: Engine, context?: string): Promise<number> {
  const eng = engine ?? detectEngine();
  const ctx = context ?? (eng === 'docker' ? findRunningColimaContext() : null);
  const contextArg = ctx ? `--context ${ctx}` : '';

  try {
    const output = execSync(
      `${eng} ${contextArg} ps -aq --filter label=${LABEL}=true`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const containerIds = output.trim().split('\n').filter(Boolean);

    if (containerIds.length === 0) {
      return 0;
    }

    for (const id of containerIds) {
      try {
        execSync(`${eng} ${contextArg} stop ${id}`, { stdio: 'ignore' });
      } catch {
        // Ignore errors
      }
      try {
        execSync(`${eng} ${contextArg} rm -f ${id}`, { stdio: 'ignore' });
      } catch {
        // Ignore errors
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
