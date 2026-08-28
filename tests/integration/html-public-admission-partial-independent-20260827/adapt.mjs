import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { base, hash, own, repository } from './common.mjs';

export function adapted(name) {
  const original = readFileSync(join(base, name), 'utf8');
  let code = original;
  const deltas = [];
  function replace(before, after) {
    assert.equal(code.split(before).length, 2, `${name}: exact single replacement ${before}`);
    code = code.replace(before, after); deltas.push({ before, after });
  }
  for (const module of ['core.mjs', 'reconstruct.mjs']) replace(`from "./${module}"`, `from ${JSON.stringify(pathToFileURL(join(base, module)).href)}`);
  replace('const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, "../../../..");', `const here = ${JSON.stringify(base)}, repository = ${JSON.stringify(repository)};`);
  if (name === 'controls-extra.mjs') replace('  json(join(output, `${name}.json`), row);', '  json(join(output, `${name}.json`), row);\n  guard(row.status === "pass", "PARTIAL_STOP", name);');
  if (name === 'run.mjs') {
    replace('npm_config_update_notifier: "false"', `npm_config_update_notifier: "false", NODE_OPTIONS: ${JSON.stringify(`--require=${join(own, 'trace.cjs')}`)}, HTML_PARTIAL_TRACE: ${JSON.stringify(join(own, 'execution', 'trace'))}`);
    replace('const result = spawnSync(executable, args, { cwd, env, encoding:', 'const result = spawnSync(executable, args, { cwd, env: { ...env, HTML_PARTIAL_COMMAND: name }, encoding:');
  }
  return { name, oldSha256: hash(original), newSha256: hash(code), deltas, code };
}
export const drivers = ['controls-extra.mjs', 'run.mjs', 'reconstruct-only.mjs'];
