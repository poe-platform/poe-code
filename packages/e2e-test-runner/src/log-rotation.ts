import { lstatSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_MAX_LOGS = 50;

export function rotateLogs(logsDir: string, maxLogs: number = DEFAULT_MAX_LOGS): number {
  if (!Number.isFinite(maxLogs) || !Number.isInteger(maxLogs) || maxLogs < 0) {
    throw new Error('maxLogs must be a finite non-negative integer');
  }

  let files: string[];
  try {
    if (lstatSync(logsDir).isSymbolicLink()) {
      throw new Error(`Logs directory must not be a symbolic link: ${logsDir}`);
    }
    files = readdirSync(logsDir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => join(logsDir, f))
      .sort((a, b) => {
        const statA = statSync(a);
        const statB = statSync(b);
        return statB.mtime.getTime() - statA.mtime.getTime();
      });
  } catch (error) {
    if (error instanceof Error && error.message.includes('symbolic link')) {
      throw error;
    }
    return 0;
  }

  if (files.length <= maxLogs) {
    return 0;
  }

  const toDelete = files.slice(maxLogs);
  let deleted = 0;
  for (const file of toDelete) {
    try {
      unlinkSync(file);
      deleted += 1;
    } catch {
      // Ignore deletion errors
    }
  }

  return deleted;
}
