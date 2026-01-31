import { setWorkspaceDir } from './container.js';
import { rotateLogs } from './log-rotation.js';
import { mkdirSync } from 'node:fs';

export interface GlobalSetupOptions {
  logsDir?: string;
  maxLogs?: number;
  workspaceDir?: string;
}

export function createGlobalSetup(options: GlobalSetupOptions = {}) {
  return async function globalSetup() {
    console.log('\nRunning e2e tests...\n');

    if (options.workspaceDir) {
      setWorkspaceDir(options.workspaceDir);
    }

    if (options.logsDir) {
      mkdirSync(options.logsDir, { recursive: true });
      const rotated = rotateLogs(options.logsDir, options.maxLogs);
      if (rotated > 0) {
        console.log(`Rotated ${rotated} old log file(s).\n`);
      }
    }
  };
}
