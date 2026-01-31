#!/usr/bin/env node

import chalk from 'chalk';
import { runInContainer, setWorkspaceDir } from './container.js';
import { getApiKey } from './credentials.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CommandGroup {
  name: string;
  commands: string[];
}

const COMMAND_GROUPS: CommandGroup[] = [
  {
    name: 'claude-code (configure)',
    commands: [
      'poe-code install claude-code',
      'poe-code configure claude-code --yes',
      'poe-code test claude-code',
    ],
  },
  {
    name: 'claude-code (isolated)',
    commands: [
      'poe-code install claude-code',
      'poe-code test claude-code --isolated',
    ],
  },
  {
    name: 'codex (configure)',
    commands: [
      'poe-code install codex',
      'poe-code configure codex --yes',
      'poe-code test codex',
    ],
  },
  {
    name: 'codex (isolated)',
    commands: [
      'poe-code install codex',
      'poe-code test codex --isolated',
    ],
  },
  {
    name: 'opencode (configure)',
    commands: [
      'poe-code install opencode',
      'poe-code configure opencode --yes',
      'poe-code test opencode',
    ],
  },
  {
    name: 'opencode (isolated)',
    commands: [
      'poe-code install opencode',
      'poe-code test opencode --isolated',
    ],
  },
  {
    name: 'kimi (configure)',
    commands: [
      'poe-code install kimi',
      'poe-code configure kimi --yes',
      'poe-code test kimi',
    ],
  },
  {
    name: 'kimi (isolated)',
    commands: [
      'poe-code install kimi',
      'poe-code test kimi --isolated',
    ],
  },
];

interface TestResult {
  name: string;
  passed: boolean;
  logPath?: string;
}

function findRepoRoot(): string {
  return join(__dirname, '..', '..', '..');
}

function redactApiKey(text: string): string {
  const apiKey = getApiKey();
  if (apiKey) {
    return text.replace(new RegExp(apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '***');
  }
  return text;
}

function makeLoginCommand(): string {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('No API key available. Set POE_API_KEY or run poe-code login.');
  }
  return `poe-code login --api-key '${apiKey}'`;
}

function printUsage(): void {
  console.log(`
Usage: e2e-runner [options] [filter]

Options:
  -v, --verbose    Show all output instead of capturing it
  -h, --help       Show this help message

Arguments:
  filter           Only run tests matching this pattern (e.g., "claude", "kimi")

Examples:
  e2e-runner                    # Run all tests in quiet mode
  e2e-runner --verbose          # Run tests with full output
  e2e-runner claude             # Run only claude-code tests
`);
}

export async function main(args: string[] = process.argv.slice(2)): Promise<number> {
  const verbose = args.includes('-v') || args.includes('--verbose');
  const help = args.includes('-h') || args.includes('--help');

  if (help) {
    printUsage();
    return 0;
  }

  // Get filter (non-flag argument)
  const filter = args.find((arg) => !arg.startsWith('-'));

  const repoRoot = findRepoRoot();
  const logDir = join(repoRoot, '.colima-logs');

  setWorkspaceDir(repoRoot);
  mkdirSync(logDir, { recursive: true });

  // Check API key
  try {
    getApiKey();
  } catch {
    console.log(chalk.red('No API key available. Set POE_API_KEY or run poe-code login.'));
    return 1;
  }

  // Filter tests if requested
  const groups = filter
    ? COMMAND_GROUPS.filter((g) => g.name.toLowerCase().includes(filter.toLowerCase()))
    : COMMAND_GROUPS;

  if (groups.length === 0) {
    console.log(chalk.red(`No tests match filter: ${filter}`));
    return 1;
  }

  const total = groups.length;
  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  console.log(chalk.bold(`\nRunning ${total} test groups...\n`));

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const index = i + 1;

    // Add login command at the start
    const commands = [makeLoginCommand(), ...group.commands];

    if (verbose) {
      console.log(chalk.bold(`\n=== [${index}/${total}] ${group.name} ===`));
      for (const cmd of commands) {
        console.log(chalk.dim(`>>> ${redactApiKey(cmd)}`));
      }
    } else {
      process.stdout.write(`  [${index}/${total}] ${group.name}... `);
    }

    const result = runInContainer(commands, { verbose });

    const logPath = join(logDir, `${group.name.replace(/[^a-z0-9-]/gi, '-')}.log`);
    writeFileSync(logPath, redactApiKey(result.stdout + '\n' + result.stderr));

    if (result.exitCode === 0) {
      passed++;
      results.push({ name: group.name, passed: true, logPath });
      if (!verbose) {
        console.log(chalk.green('✓'));
      }
    } else {
      failed++;
      results.push({ name: group.name, passed: false, logPath });
      if (!verbose) {
        console.log(chalk.red('✗'));
      }
    }
  }

  // Summary
  console.log(chalk.bold('\nResults:'));
  console.log(`  ${chalk.green(`✓ ${passed} passed`)}`);
  if (failed > 0) {
    console.log(`  ${chalk.red(`✗ ${failed} failed`)}`);
  }

  // Show failed logs in quiet mode
  if (failed > 0 && !verbose) {
    console.log(chalk.bold('\nFailed tests:'));
    for (const result of results) {
      if (!result.passed && result.logPath) {
        console.log(chalk.red(`\n--- ${result.name} ---`));
        console.log(chalk.dim(`Log: ${result.logPath}`));

        try {
          const logContent = readFileSync(result.logPath, 'utf-8');
          const lines = logContent.split('\n');
          const tail = lines.slice(-50);
          for (const line of tail) {
            console.log(`  ${line}`);
          }
        } catch {
          // Ignore read errors
        }
      }
    }
  }

  return failed > 0 ? 1 : 0;
}

// Run if executed directly
if (import.meta.url.startsWith('file:')) {
  const modulePath = fileURLToPath(import.meta.url);
  if (process.argv[1] === modulePath) {
    main().then((code) => process.exit(code));
  }
}
