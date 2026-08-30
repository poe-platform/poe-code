import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hashRegularFile } from './hash-regular-file.mjs';
export const own = path.dirname(fileURLToPath(import.meta.url));
export const repo = path.resolve(own, '../../..');
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const objectHash = (kind, bytes) => createHash('sha1').update(Buffer.from(kind + ' ' + bytes.length + '\0')).update(bytes).digest('hex');
export const hashExecutable = async filename => hashRegularFile(filename).sha256;
