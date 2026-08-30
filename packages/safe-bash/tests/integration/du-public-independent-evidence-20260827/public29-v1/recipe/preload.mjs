import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, appendFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as frozenHook from './load-proof-hook.mjs';

const config = JSON.parse(readFileSync(process.env.DU_CONFIG));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function privateGuard(url) { assert.ok(!url.includes('/shell/cancellation.'), 'PRIVATE_HELPER_LOAD_FORBIDDEN'); }
if (config.profile === 'moved') {
  frozenHook.initialize(config);
  registerHooks({ resolve: frozenHook.resolve, load(url, context, nextLoad) { privateGuard(url); return frozenHook.load(url, context, nextLoad); } });
} else {
  assert.equal(config.profile, 'source');
  writeFileSync(config.tracePath, '', { flag: 'wx' });
  const consumer = realpathSync(config.consumerRoot);
  function key(url) {
    const target = realpathSync(fileURLToPath(url));
    const name = relative(consumer, target).split(sep).join('/');
    assert.ok(!name.startsWith('../') && !name.startsWith('/'));
    assert.ok(Object.hasOwn(config.expectedLoads, name), `UNBOUND_SOURCE_PROFILE:${name}`);
    return name;
  }
  function trace(value) { appendFileSync(config.tracePath, `${JSON.stringify(value)}\n`); }
  registerHooks({
    resolve(specifier, context, nextResolve) {
      let result;
      if (Object.hasOwn(config.publicTargets, specifier)) result = { url: pathToFileURL(resolve(consumer, config.publicTargets[specifier])).href, shortCircuit: true };
      else if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.includes('/node_modules/virtual-bash/src/')) {
        const url = new URL(specifier.slice(0, -3) + '.ts', context.parentURL).href;
        key(url); result = { url, shortCircuit: true };
      } else result = nextResolve(specifier, context);
      if (Object.hasOwn(config.publicTargets, specifier)) trace({ event: 'public-resolution', specifier, url: result.url, key: key(result.url), explicitSourceProfile: true });
      return result;
    },
    load(url, context, nextLoad) {
      if (url.startsWith('node:')) return nextLoad(url, context);
      privateGuard(url);
      const name = key(url);
      if (url.endsWith('.ts')) {
        assert.ok(name.startsWith('node_modules/virtual-bash/src/'));
        const source = readFileSync(fileURLToPath(url));
        assert.equal(hash(source), config.expectedLoads[name]);
        const evaluated = stripTypeScriptTypes(source.toString(), { mode: 'transform', sourceUrl: url });
        trace({ event: 'module-load', key: name, url, sha256: hash(source), sourceBytes: source.length, evaluatedSha256: hash(evaluated), evaluatedBytes: Buffer.byteLength(evaluated), transform: 'pinned Node22.22.2 stripTypeScriptTypes mode=transform; source profile only' });
        return { format: 'module', source: evaluated, shortCircuit: true };
      }
      const result = nextLoad(url, context);
      assert.equal(result.format, 'module');
      assert.ok(result.source !== null && result.source !== undefined);
      assert.equal(hash(result.source), config.expectedLoads[name]);
      trace({ event: 'module-load', key: name, url, sha256: hash(result.source), bytes: Buffer.byteLength(result.source), transform: null });
      return result;
    },
  });
}
