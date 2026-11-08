import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { installGuard } from './guard.mjs';
import { check, verifyTree, exactJson } from './core.mjs';

const [root, manifestFile, mode, size, digest, fallback] = process.argv.slice(2);
check(Number.isSafeInteger(Number(size)) && Number(size) > 0 && Number(size) <= 16384, 'SYNTHETIC_MANIFEST_BOUND');
const manifest = await exactJson(manifestFile, { bytes: Number(size), sha256: digest });
await verifyTree(root, manifest);
installGuard(root, manifest);
const module = await import(pathToFileURL(path.join(root, 'synthetic-module.mjs')).href);
check(module.classification === 'SYNTHETIC_HELPER_CONTROL_NOT_PRODUCT' && typeof module.command().execute === 'function', 'VALID_CONTROL_FIRST');
process.stdout.write('VALID_CONTROL_FIRST\n');
try {
  const result = await module.boundary(mode, pathToFileURL(mode === 'sourcefallback' ? fallback : path.join(root, '../outside.mjs')).href);
  process.stdout.write(`${JSON.stringify({ status: 'RETURNED', result })}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ status: 'BOUNDARY', code: error.code ?? null, name: error.name })}\n`);
  if (!['DENY_LOAD', 'DENY_BUILTIN', 'DENY_AMBIENT'].includes(error.code) && !(mode === 'eval' && error.name === 'EvalError')) process.exitCode = 1;
}
