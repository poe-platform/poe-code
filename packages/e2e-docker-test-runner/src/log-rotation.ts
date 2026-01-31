import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_MAX_LOGS = 50;

export function rotateLogs(logsDir: string, maxLogs: number = DEFAULT_MAX_LOGS): number {
  let files: string[];
  try {
    files = readdirSync(logsDir)
      .filter((f) => f.endsWith('.log'))
      .map((f) => join(logsDir, f))
      .sort((a, b) => {
        const statA = statSync(a);
        const statB = statSync(b);
        return statB.mtime.getTime() - statA.mtime.getTime();
      });
  } catch {
    return 0;
  }

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
