import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const sha = value => createHash('sha256').update(value).digest('hex');
const bytes = fs.readFileSync(process.env.TIMEOUT_CONFIG);
assert.equal(sha(bytes), process.env.TIMEOUT_CONFIG_SHA256, 'CONFIG_HASH');
const config = JSON.parse(bytes);
assert.equal(config.executionAuthorized, true, 'PRODUCT_EXECUTION_NOT_AUTHORIZED');
assert.match(config.candidate, /^[a-f0-9]{40}$/u);
fs.writeFileSync(config.trace, '', { flag: 'wx' });
const trace = row => fs.appendFileSync(config.trace, JSON.stringify(row) + '\n');
function bound(url) {
  const parsed = new URL(url); assert.equal(parsed.protocol, 'file:'); assert.equal(parsed.search, ''); assert.equal(parsed.hash, '');
  const filename = fileURLToPath(parsed); assert.ok(!filename.split('/').some(part => part.toLowerCase() === 'agents.md'), 'AGENTS_NAME');
  if (!Object.hasOwn(config.loads, filename)) { trace({ kind: 'strict-load-allowlist-denial', path: filename, beforeProductLoad: true }); assert.fail(`UNBOUND_MODULE:${filename}`); }
  assert.equal(fs.realpathSync(filename), filename, 'MODULE_SYMLINK'); return filename;
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    let result;
    const isPublic = specifier === 'virtual-bash' || specifier === 'virtual-bash/commands/timeout';
    if (isPublic && config.profile === 'source') result = { url: pathToFileURL(config.sourceEntries[specifier]).href, shortCircuit: true };
    else if (isPublic) result = nextResolve(specifier, { ...context, parentURL: pathToFileURL(config.consumerEntry).href });
    else if (config.profile === 'source' && specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.startsWith(pathToFileURL(`${config.productRoot}/src/`).href)) result = { url: new URL(specifier.slice(0,-3) + '.ts', context.parentURL).href, shortCircuit: true };
    else result = nextResolve(specifier, context);
    if (!result.url.startsWith('node:')) bound(result.url);
    if (isPublic) trace({ kind: 'entrypoint-resolution', specifier, url: result.url, throughActualPackageExports: config.profile !== 'source', sourceAdapter: config.profile === 'source' });
    return result;
  },
  load(url, context, nextLoad) {
    if (url.startsWith('node:')) return nextLoad(url, context);
    const filename = bound(url);
    if (config.profile === 'source' && filename.endsWith('.ts')) {
      assert.ok(filename.startsWith(`${config.productRoot}/src/`), 'UNBOUND_TYPESCRIPT');
      const input = fs.readFileSync(filename); assert.equal(sha(input), config.loads[filename], 'MODULE_HASH_MISMATCH');
      const source = stripTypeScriptTypes(input.toString(), { mode: 'transform', sourceUrl: url });
      trace({ kind: 'actual-module-load', path: filename, sha256: sha(input), transformedSha256: sha(source), sourceAdapter: true });
      return { format: 'module', source, shortCircuit: true };
    }
    const result = nextLoad(url, context); assert.equal(result.format, 'module'); assert.ok(result.source != null);
    const input = Buffer.from(result.source); assert.equal(sha(input), config.loads[filename], 'MODULE_HASH_MISMATCH');
    trace({ kind: 'actual-module-load', path: filename, sha256: sha(input), bytes: input.length, sourceAdapter: false }); return result;
  },
});
