import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { bounds as previous, layouts } from '../contract.mjs';
export const bounds = Object.freeze({ ...previous, sampledLogicalWorkBytes:536870912, asyncLoaderAdmissions:3, asyncLoaderPeak:1 });
function absolute(value) { assert(typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0')); return value; }
export function commandEnvelope(admitted) {
  for (const key of ['node','npm','loader','entry','archive','ownedRoot','stageRoot','toolsRoot']) absolute(admitted[key]);
  assert.equal(admitted.identitySizeHashAuthenticated, true);
  assert.equal(admitted.packageAndSourceFitProved, true);
  assert.equal(admitted.npmLifecycleEligibilityAuthenticated, true);
  const common = { PATH:path.dirname(admitted.node), HOME:path.join(admitted.ownedRoot,'home'), TMPDIR:path.join(admitted.ownedRoot,'tmp'), TMP:path.join(admitted.ownedRoot,'tmp'), TEMP:path.join(admitted.ownedRoot,'tmp'), LANG:'C', LC_ALL:'C', TZ:'UTC', NODE_OPTIONS:'', NODE_PATH:'', NPM_CONFIG_USERCONFIG:path.join(admitted.ownedRoot,'home/user.npmrc'), NPM_CONFIG_GLOBALCONFIG:path.join(admitted.ownedRoot,'home/global.npmrc'), NPM_CONFIG_OFFLINE:'true', NPM_CONFIG_AUDIT:'false', NPM_CONFIG_FUND:'false' };
  const permissions = ['--experimental-permission', `--allow-fs-read=${admitted.ownedRoot}`, `--allow-fs-read=${admitted.stageRoot}`, `--allow-fs-read=${admitted.toolsRoot}`, `--allow-fs-read=${admitted.node}`];
  const commands = [{ role:'offline-install', tool:admitted.node, env:common, argv:[...permissions, `--allow-fs-write=${admitted.ownedRoot}`, admitted.npm, 'install','--offline','--ignore-scripts','--no-audit','--no-fund','--package-lock=false','--cache',path.join(admitted.ownedRoot,'cache'),'--prefix',path.join(admitted.ownedRoot,'installed'),admitted.archive] }];
  for (const layout of layouts) {
    const binding = admitted.layoutBindings[layout];
    absolute(binding.path); assert(Number.isSafeInteger(binding.bytes) && binding.bytes > 0); assert.match(binding.sha256,/^[0-9a-f]{64}$/);
    commands.push({role:`smoke-${layout}`,tool:admitted.node,env:{...common,PUBLIC_BINDING:binding.path,PUBLIC_BINDING_BYTES:String(binding.bytes),PUBLIC_BINDING_SHA256:binding.sha256},argv:[...permissions,`--allow-fs-write=${admitted.ownedRoot}`,'--allow-worker','--loader',pathToFileURL(admitted.loader).href,admitted.entry,layout,binding.path]});
  }
  return commands;
}
