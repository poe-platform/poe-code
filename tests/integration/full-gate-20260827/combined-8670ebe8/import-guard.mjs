import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(process.env.FULL_GATE_ROOT);
const source = realpathSync(process.env.FULL_GATE_SOURCE);
const expected = JSON.parse(readFileSync(process.env.FULL_GATE_EXPECTED));
const tools = JSON.parse(process.env.FULL_GATE_TOOL_ROOTS ?? '[]').map(path => realpathSync(path));
const logs = process.env.FULL_GATE_IMPORTS;
mkdirSync(logs, { recursive: true });
const seen = new Set();
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => appendFileSync(join(logs, `${process.pid}.ndjson`), JSON.stringify({ pid: process.pid, ...value }) + '\n');
const check = url => {
  if (url.startsWith('node:')) return;
  assert.ok(url.startsWith('file:'), `Unsupported module protocol: ${url}`);
  const path = realpathSync(fileURLToPath(url));
  assert.ok(path.startsWith(root + '/') || tools.some(tool => path.startsWith(tool + '/')), `FROZEN_IMPORT_OUTSIDE: ${path}`);
  const local = relative(source, path);
  assert.ok(!/^src\/commands\/(execution|env-split)\.js$/u.test(local), `Frozen env compiled-source fallback: ${path}`);
  const critical = Object.hasOwn(expected, local);
  const sha256 = hash(readFileSync(path));
  if (critical) assert.equal(sha256, expected[local], `Frozen env source bytes: ${local}`);
  return { resolved: path, relative: local, sha256, critical };
};
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context), entry = check(result.url);
    if (entry && !seen.has(entry.resolved)) {
      seen.add(entry.resolved);
      record({ stage: 'resolve', specifier, parent: context.parentURL, ...entry });
    }
    return result;
  },
  load(url, context, next) {
    const entry = check(url);
    const result = next(url, context);
    if (entry?.critical) {
      assert.ok(result.source !== null && result.source !== undefined, `Missing env load bytes: ${entry.relative}`);
      const bytes = typeof result.source === 'string' ? Buffer.from(result.source) : ArrayBuffer.isView(result.source)
        ? Buffer.from(result.source.buffer, result.source.byteOffset, result.source.byteLength) : Buffer.from(result.source);
      assert.ok(bytes.length > 0, 'Empty env load source');
      record({ stage: 'load', ...entry, format: result.format, returnedBytes: bytes.length, returnedSha256: hash(bytes) });
    }
    return result;
  },
});
