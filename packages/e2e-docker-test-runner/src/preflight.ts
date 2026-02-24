import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { detectEngine } from './engine.js';
import { hasApiKey } from './credentials.js';
import { IMAGE_NAME } from './image.js';
import { setResolvedContext, getResolvedContext, detectRunningContext } from './context.js';
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
  const apiKeyCheck = await checkApiKey();
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

  // Prune old e2e images and build cache to prevent disk full errors
  const pruned = pruneOldImages(engine);
  if (pruned > 0) {
    results.push({
      name: 'Docker prune',
      passed: true,
      message: `Removed ${pruned} old e2e image(s) and pruned build cache`,
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

function checkDaemonRunning(engine: Engine): CheckResult {
  // First check if there's a running colima profile we should use
  const runningContext = detectRunningContext();
  if (runningContext && engine === 'docker') {
    try {
      execSync(`${engine} --context ${runningContext} info`, { stdio: 'ignore' });
      setResolvedContext(runningContext);
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
      // Re-discover context after starting colima
      const newContext = detectRunningContext();
      if (newContext && engine === 'docker') {
        try {
          execSync(`${engine} --context ${newContext} info`, { stdio: 'ignore' });
          setResolvedContext(newContext);
          return { name: 'Docker daemon running', passed: true, message: `Started colima (${newContext})` };
        } catch {
          // Fall through
        }
      }

      try {
        execSync(`${engine} info`, { stdio: 'ignore' });
        return { name: 'Docker daemon running', passed: true, message: 'Started colima' };
      } catch {
        // Still failed after starting colima
      }
    }

    // Try to auto-start Docker Desktop if available (macOS only)
    if (tryStartDockerDesktop()) {
      return { name: 'Docker daemon running', passed: true, message: 'Started Docker Desktop' };
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
      try {
        execSync('colima start', { stdio: 'inherit', timeout: 120000 });
        return true;
      } catch {
        // Start failed (e.g. stale/corrupted VM), delete and recreate
        console.log(chalk.dim('Colima start failed, deleting stale instance and retrying...'));
        try {
          execSync('colima delete --force', { stdio: 'ignore', timeout: 30000 });
          const dns = detectHostDns();
          const dnsArgs = dns.length > 0 ? dns.map((d: string) => `--dns ${d}`).join(' ') : '--dns 8.8.8.8';
          execSync(`colima start ${dnsArgs}`, { stdio: 'inherit', timeout: 120000 });
          return true;
        } catch {
          return false;
        }
      }
    }
  } catch {
    return false;
  }
}

function detectHostDns(): string[] {
  try {
    const output = execSync('scutil --dns', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    const servers: string[] = [];
    for (const line of output.split('\n')) {
      const match = line.match(/nameserver\[\d+\]\s*:\s*(\d+\.\d+\.\d+\.\d+)/);
      if (match && !servers.includes(match[1])) {
        servers.push(match[1]);
      }
    }
    return servers;
  } catch {
    return [];
  }
}

function tryStartDockerDesktop(): boolean {
  if (process.platform !== 'darwin') {
    return false;
  }

  try {
    execSync('test -d "/Applications/Docker.app"', { stdio: 'ignore' });
  } catch {
    return false;
  }

  try {
    console.log(chalk.dim('Starting Docker Desktop...'));
    execSync('open -a Docker', { stdio: 'ignore' });

    // Poll for daemon readiness (up to 60 seconds)
    for (let i = 0; i < 30; i++) {
      try {
        execSync('docker info', { stdio: 'ignore' });
        return true;
      } catch {
        execSync('sleep 2', { stdio: 'ignore' });
      }
    }

    return false;
  } catch {
    return false;
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

function pruneOldImages(engine: Engine): number {
  const ctx = engine === 'docker' ? getResolvedContext() : null;
  const contextArg = ctx ? `--context ${ctx}` : '';

  try {
    // Find all poe-code-e2e images
    const output = execSync(
      `${engine} ${contextArg} images --format "{{.Repository}}:{{.Tag}}" ${IMAGE_NAME}`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const images = output.trim().split('\n').filter(Boolean);

    if (images.length <= 1) {
      return 0;
    }

    // Remove all old images (the current one will be rebuilt if needed)
    for (const image of images) {
      try {
        execSync(`${engine} ${contextArg} rmi ${image}`, { stdio: 'ignore' });
      } catch {
        // Image might be in use, skip
      }
    }

    // Prune dangling images and build cache
    execSync(`${engine} ${contextArg} image prune -f`, { stdio: 'ignore' });
    execSync(`${engine} ${contextArg} builder prune -f`, { stdio: 'ignore' });

    return images.length;
  } catch {
    return 0;
  }
}

export async function cleanupOrphans(engine?: Engine, context?: string): Promise<number> {
  const eng = engine ?? detectEngine();
  const ctx = context ?? (eng === 'docker' ? detectRunningContext() : null);
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
