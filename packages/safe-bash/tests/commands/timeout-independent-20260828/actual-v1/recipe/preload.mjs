import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hash = value => createHash('sha256').update(value).digest('hex');
const configurationBytes = fs.readFileSync(process.env.TIMEOUT_CONFIG);
assert.equal(hash(configurationBytes), process.env.TIMEOUT_CONFIG_SHA256);
const config = JSON.parse(configurationBytes);
const trace = value => fs.appendFileSync(config.trace, `${JSON.stringify(value)}\n`);
fs.writeFileSync(config.trace, '', { flag: 'wx' });
function bound(url) {
  const parsed = new URL(url); assert.equal(parsed.protocol, 'file:'); assert.equal(parsed.search, ''); assert.equal(parsed.hash, '');
  const path = fileURLToPath(parsed); assert.equal(fs.realpathSync(path), path); assert.ok(Object.hasOwn(config.loads, path), `UNBOUND_MODULE:${path}`); return path;
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    let result;
    if (Object.hasOwn(config.targets, specifier)) result = { url: pathToFileURL(config.targets[specifier]).href, shortCircuit: true };
    else if (config.profile === 'source' && specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.startsWith(pathToFileURL(`${config.sourceRoot}/src/`).href)) result = { url: new URL(specifier.slice(0, -3) + '.ts', context.parentURL).href, shortCircuit: true };
    else result = nextResolve(specifier, context);
    if (!result.url.startsWith('node:')) bound(result.url);
    if (Object.hasOwn(config.targets, specifier)) trace({ kind: 'explicit-internal-resolution', specifier, url: result.url, publicExportClaim: false });
    return result;
  },
  load(url, context, nextLoad) {
    if (url.startsWith('node:')) return nextLoad(url, context);
    const path = bound(url);
    if (config.profile === 'source' && path.endsWith('.ts')) {
      assert.ok(path.startsWith(`${config.sourceRoot}/src/`)); const bytes = fs.readFileSync(path); assert.equal(hash(bytes), config.loads[path], 'MODULE_HASH_MISMATCH');
      const source = stripTypeScriptTypes(bytes.toString(), { mode: 'transform', sourceUrl: url });
      trace({ kind: 'actual-module-load', path, sha256: hash(bytes), transformedSha256: hash(source), transform: 'pinned Node22.22.2 stripTypeScriptTypes', bytes: bytes.length });
      return { format: 'module', source, shortCircuit: true };
    }
    const result = nextLoad(url, context); assert.equal(result.format, 'module'); assert.ok(result.source != null); const bytes = typeof result.source === 'string' ? Buffer.from(result.source) : Buffer.from(result.source); assert.equal(hash(bytes), config.loads[path], 'MODULE_HASH_MISMATCH');
    trace({ kind: 'actual-module-load', path, sha256: hash(bytes), bytes: bytes.length, transformedSha256: null }); return result;
  },
});
