import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const started = performance.now();
const root = '/Users/kjopek/Workspace/safe-bash';
export function admit(filename, expected, maximum) {
  const stat = fs.lstatSync(filename);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, expected.bytes); assert.ok(stat.size <= maximum);
  const body = fs.readFileSync(filename);
  assert.equal(body.length, expected.bytes);
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'), expected.sha256);
  return body;
}
export async function main(args) {
  assert.equal(args.length, 4); assert.equal(args[0], '--run');
  assert.equal(process.env.B1_ROOT_GO, 'ROOT_B1_PUBLIC15_EXPLICIT_FRESH_AUTHORIZATION');
  const seal = JSON.parse(admit(args[1], { bytes: Number(args[3]), sha256: args[2] }, 1048576));
  assert.equal(seal.schema, 'coherent-b1-public15-preseal-v1');
  for (const entry of seal.files) admit(path.join(root, entry.path), entry, 4194304);
  assert.ok(performance.now() - started < 60000);
  const runner = await import('./run.mjs');
  await runner.main(seal, started);
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2));
