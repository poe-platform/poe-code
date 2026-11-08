import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

let admission;

function inside(parent, child) {
  const local = relative(parent, child);
  return local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local);
}

function fileKey(url) {
  assert.ok(admission, 'loader must be initialized by authenticated supervisor');
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'file:', 'only builtins and authenticated file modules');
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, '');
  const actualPath = realpathSync(fileURLToPath(parsed));
  assert.ok(inside(admission.consumerRoot, actualPath), 'module escaped physically moved consumer');
  const key = relative(admission.consumerRoot, actualPath).split(sep).join('/');
  assert.ok(Object.hasOwn(admission.expectedLoads, key), `unexpected loaded path: ${key}`);
  return key;
}

function trace(record) {
  appendFileSync(admission.tracePath, `${JSON.stringify(record)}\n`);
}

export function initialize(data) {
  assert.equal(admission, undefined, 'single initialization');
  assert.ok(data && typeof data === 'object');
  const consumerRoot = realpathSync(data.consumerRoot);
  const packageRoot = realpathSync(resolvePath(consumerRoot, 'node_modules/virtual-bash'));
  assert.ok(inside(consumerRoot, packageRoot), 'installed package cannot symlink to workspace');
  assert.equal(typeof data.tracePath, 'string');
  assert.ok(data.expectedLoads && Object.keys(data.expectedLoads).length > 0);
  for (const [key, hash] of Object.entries(data.expectedLoads)) {
    assert.ok(!isAbsolute(key) && !key.split('/').includes('..'));
    assert.match(hash, /^[a-f0-9]{64}$/u);
  }
  assert.deepEqual(Object.keys(data.publicTargets).sort(), ['virtual-bash', 'virtual-bash/commands/du']);
  for (const target of Object.values(data.publicTargets)) {
    assert.ok(target.startsWith('node_modules/virtual-bash/dist/'), 'public entry must be installed dist');
    assert.ok(Object.hasOwn(data.expectedLoads, target));
  }
  writeFileSync(data.tracePath, '', { flag: 'wx' });
  admission = { ...data, consumerRoot, packageRoot };
}

export function resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context);
  if (specifier === 'virtual-bash' || specifier === 'virtual-bash/commands/du') {
    const key = fileKey(result.url);
    assert.equal(key, admission.publicTargets[specifier], `wrong public resolution: ${specifier}`);
    trace({ event: 'public-resolution', specifier, url: result.url, key });
  }
  return result;
}

export function load(url, context, nextLoad) {
  if (url.startsWith('node:')) return nextLoad(url, context);
  const key = fileKey(url);
  const result = nextLoad(url, context);
  assert.equal(result.format, 'module', 'no CJS/source fallback');
  assert.ok(result.source !== undefined && result.source !== null, 'actual loaded source bytes required');
  const source = typeof result.source === 'string' ? Buffer.from(result.source) : ArrayBuffer.isView(result.source)
    ? Buffer.from(result.source.buffer, result.source.byteOffset, result.source.byteLength)
    : Buffer.from(result.source);
  const sha256 = createHash('sha256').update(source).digest('hex');
  assert.equal(sha256, admission.expectedLoads[key], `evaluated source differs: ${key}`);
  trace({ event: 'module-load', url, key, sha256, bytes: source.byteLength, format: result.format });
  return result;
}
