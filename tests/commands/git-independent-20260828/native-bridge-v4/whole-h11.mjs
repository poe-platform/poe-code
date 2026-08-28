import vm from 'node:vm';
import { HASHES, sha256, need, exact, ownValue } from './finite.mjs';

export const IMPORTS = Object.freeze({
  'node:assert/strict': ['default'],
  'node:child_process': ['execFileSync', 'spawn'],
  'node:fs': ['createWriteStream', 'mkdirSync', 'existsSync'],
  'node:path': ['dirname'],
  'node:timers/promises': ['setTimeout'],
});
export async function loadWholeH11(source, bindings, globals) {
  need(typeof source === 'string' && sha256(source) === HASHES.h11, 'whole authenticated H11 body');
  exact(Reflect.ownKeys(bindings).sort(), Object.keys(IMPORTS).sort(), 'no host/product/fallback imports');
  for (const [specifier, names] of Object.entries(IMPORTS)) {
    ownValue(bindings, specifier);
    exact(Reflect.ownKeys(bindings[specifier]).sort(), [...names].sort(), 'full exact import role');
    for (const name of names) need(Object.hasOwn(Object.getOwnPropertyDescriptor(bindings[specifier], name), 'value'), 'no binding accessors');
  }
  exact(Reflect.ownKeys(globals).sort(), ['Date', 'clearInterval', 'clearTimeout', 'process', 'setInterval', 'setTimeout'].sort(), 'no ambient globals');
  for (const name of Object.keys(globals)) ownValue(globals, name);
  need(typeof vm.SourceTextModule === 'function', 'explicit bound VM capability');
  const context = vm.createContext(globals, { codeGeneration: { strings: false, wasm: false } });
  const module = new vm.SourceTextModule(source, { context, identifier: 'inert:h11-whole-f03c260', importModuleDynamically() { throw new Error('dynamic import denied'); } });
  exact([...module.dependencySpecifiers].sort(), Object.keys(IMPORTS).sort(), 'H11 import census');
  await module.link(specifier => {
    need(Object.hasOwn(IMPORTS, specifier), 'closed H11 import');
    return new vm.SyntheticModule(IMPORTS[specifier], function () {
      for (const name of IMPORTS[specifier]) this.setExport(name, bindings[specifier][name]);
    }, { context, identifier: `inert:${specifier}` });
  });
  await module.evaluate({ timeout: 1000 });
  exact(Object.keys(module.namespace), ['processes', 'supervise'], 'whole H11 namespace');
  return module.namespace;
}
