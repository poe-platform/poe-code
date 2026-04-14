#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, watch, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_LOGS_DIR = '.e2e-logs';
const DEFAULT_MAX_LOGS = 50;

interface Args {
  filter?: string;
  follow: boolean;
  logsDir: string;
  rotate: boolean;
  maxLogs: number;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let filter: string | undefined;
  let follow = false;
  let logsDir = DEFAULT_LOGS_DIR;
  let rotate = false;
  let maxLogs = DEFAULT_MAX_LOGS;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--follow' || arg === '-f') {
      follow = true;
    } else if (arg === '--dir' && args[i + 1]) {
      logsDir = args[++i];
    } else if (arg === '--rotate' || arg === '-r') {
      rotate = true;
    } else if (arg === '--max-logs' && args[i + 1]) {
      maxLogs = parseInt(args[++i], 10);
    } else if (!arg.startsWith('-')) {
      filter = arg;
    }
  }

  return { filter, follow, logsDir, rotate, maxLogs };
}

function getLogFiles(logsDir: string, filter?: string): string[] {
  try {
    const files = readdirSync(logsDir)
      .filter((f) => f.endsWith('.log'))
      .filter((f) => !filter || f.includes(filter))
      .map((f) => join(logsDir, f))
      .sort((a, b) => {
        const statA = statSync(a);
        const statB = statSync(b);
        return statB.mtime.getTime() - statA.mtime.getTime();
      });
    return files;
  } catch {
    return [];
  }
}

function rotateLogs(logsDir: string, maxLogs: number): number {
  const files = getLogFiles(logsDir);

  if (files.length <= maxLogs) {
    return 0;
  }

  const toDelete = files.slice(maxLogs);
  for (const file of toDelete) {
    try {
      unlinkSync(file);
    } catch {
      // Ignore deletion errors
    }
  }

  return toDelete.length;
}

function showLogs(logsDir: string, filter?: string) {
  const files = getLogFiles(logsDir, filter);

  if (files.length === 0) {
    console.log('No log files found.');
    return;
  }

  console.log(`Showing ${files.length} log file(s):\n`);

  for (const file of files.slice(0, 10)) {
    const name = file.split('/').pop();
    console.log(`=== ${name} ===\n`);
    console.log(readFileSync(file, 'utf-8'));
    console.log('');
  }

  if (files.length > 10) {
    console.log(`... and ${files.length - 10} more files`);
  }
}

function followLogs(logsDir: string, filter?: string) {
  console.log(`Watching for new logs in ${logsDir}...`);
  console.log('Press Ctrl+C to exit.\n');

  const shown = new Set<string>();

  const check = () => {
    const files = getLogFiles(logsDir, filter);
    for (const file of files) {
      if (!shown.has(file)) {
        shown.add(file);
        const name = file.split('/').pop();
        console.log(`=== ${name} ===\n`);
        console.log(readFileSync(file, 'utf-8'));
        console.log('');
      }
    }
  };

  check();

  try {
    watch(logsDir, () => check());
  } catch {
    // Directory may not exist yet
    setInterval(check, 1000);
  }
}

function main() {
  const { filter, follow, logsDir, rotate, maxLogs } = parseArgs();

  if (rotate) {
    const deleted = rotateLogs(logsDir, maxLogs);
    if (deleted === 0) {
      console.log(`No logs to rotate (keeping max ${maxLogs} files).`);
    } else {
      console.log(`Rotated ${deleted} old log file(s).`);
    }
    return;
  }

  // Auto-rotate before showing logs
  rotateLogs(logsDir, maxLogs);

  if (follow) {
    followLogs(logsDir, filter);
  } else {
    showLogs(logsDir, filter);
  }
}

main();
