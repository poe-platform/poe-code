import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
export const own = path.dirname(fileURLToPath(import.meta.url));
export const repo = '/Users/kjopek/Workspace/safe-bash';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const objectHash = (type, bytes) => createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
