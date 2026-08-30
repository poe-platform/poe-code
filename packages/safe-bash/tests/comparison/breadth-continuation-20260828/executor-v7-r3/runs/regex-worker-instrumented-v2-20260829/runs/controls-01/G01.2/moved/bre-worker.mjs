import { isMainThread } from 'node:worker_threads';
import { identity } from './protocol.mjs';
export const finish = value => isMainThread ? 0 : identity(value);
