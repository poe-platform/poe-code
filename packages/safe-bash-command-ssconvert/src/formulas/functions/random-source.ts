import { SsconvertError } from '../../contracts.js';
import type { FunctionHost } from './types.js';
export function uniformRandom(host: FunctionHost): number {
  host.tick();
  if (!host.context.random) throw new SsconvertError('capability-denied','ssconvert random functions require an explicit random source');
  const x = host.context.random.next();
  if (!Number.isFinite(x) || x < 0 || x >= 1) throw new SsconvertError('invalid-request','Invalid ssconvert random result');
  return x;
}
