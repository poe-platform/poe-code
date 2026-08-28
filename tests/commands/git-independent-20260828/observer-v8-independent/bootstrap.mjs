import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const [filename, expected, entry] = process.argv.slice(2);
const bytes = fs.readFileSync(filename); assert.equal(hash(bytes), expected);
const manifest = JSON.parse(bytes); assert.equal(process.execPath, manifest.node.path); assert.equal(process.version, manifest.node.version); assert.equal(hash(fs.readFileSync(process.execPath)), manifest.node.sha256);
assert.ok(['worker.mjs', 'counter.mjs'].includes(entry));
registerHooks({ load(url, context, next) {
  if (url.startsWith('node:')) { assert.ok(manifest.builtins.includes(url), 'undeclared builtin'); return next(url, context); }
  assert.ok(url.startsWith('file:')); const absolute = fileURLToPath(url); assert.equal(fs.realpathSync(absolute), absolute); assert.ok(Object.hasOwn(manifest.files, absolute), 'outside observer executable closure');
  const result = next(url, context); const source = Buffer.from(result.source); assert.equal(hash(source), manifest.files[absolute].sha256);
  process.stdout.write(JSON.stringify({ kind: 'load', path: absolute, sha256: hash(source) }) + '\n'); return result;
} });
await import(pathToFileURL(manifest.root + '/' + entry).href);
