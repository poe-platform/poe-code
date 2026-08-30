import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isMainThread, threadId } from 'node:worker_threads';
const manifest = JSON.parse(fs.readFileSync(process.env.FIXTURE_MANIFEST, 'utf8'));
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ kind: 'loader-start', isMainThread, threadId }) + '\n');
const builtins = new Set(['node:assert/strict', 'node:fs', 'node:path', 'node:url', 'node:crypto', 'node:worker_threads', 'node:module']);
export function load(url, context, next) {
  if (builtins.has(url)) return next(url, context);
  if (!url.startsWith('file:')) throw Error('unbound module scheme');
  const filename = fileURLToPath(url), row = manifest.files.find(item => item.path === filename);
  if (!row) throw Error('unbound fixture module');
  const metadata = fs.lstatSync(filename);
  if (!metadata.isFile() || metadata.isSymbolicLink() || fs.realpathSync(filename) !== filename || metadata.size > 65536) throw Error('fixture file admission');
  const bytes = fs.readFileSync(filename);
  if (bytes.length !== row.bytes || createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw Error('fixture module hash');
  return { format: 'module', source: bytes, shortCircuit: true };
}
