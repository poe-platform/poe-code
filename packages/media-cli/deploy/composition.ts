import { Shell, type FileSystem } from '@poe-platform/safe-bash';
import type { MediaEngineRequest } from '../src/index.js';
import { mediaCommands } from '../../safe-bash/src/commands/media/plugin.js';
export interface WorkerRuntime {
  fs: FileSystem;
  engine: { execute(request: MediaEngineRequest): Promise<{ exitCode: number }> };
}
export function createWorkerShell(runtime: WorkerRuntime): Shell {
  if (!runtime.fs) throw new TypeError('Explicit canonical filesystem required');
  return new Shell({ fs: runtime.fs, env: {}, limits: {
    maxInputBytes: 67108864, maxOutputBytes: 67108864,
    maxSourceBytes: 8192, maxExpansionBytes: 65536, pipeHighWaterMark: 65536,
    maxWallClockMs: 300000,
  } }).use(mediaCommands({ engine: runtime.engine }));
}
