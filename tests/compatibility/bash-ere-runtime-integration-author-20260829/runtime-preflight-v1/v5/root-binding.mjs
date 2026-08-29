import * as fs from 'node:fs';
import * as path from 'node:path';

export const repositoryRoot = '/Users/kjopek/Workspace/safe-bash';
const scope = 'tests/compatibility/bash-ere-runtime-integration-author-20260829/runtime-preflight-v1/';
export const sourcePaths = [
  scope + 'v4/pure-controls.mjs', scope + 'v4/guards.mjs', scope + 'v4/array-observer.mjs',
  scope + 'v5/root-binding.mjs', scope + 'v5/prepare.mjs', scope + 'v5/PRESEAL.md',
];
export const copyNames = ['pure-controls.mjs', 'guards.mjs', 'array-observer.mjs', 'root-binding.mjs'];
export function resolveInventoryPath(member, declaredRoot, controlRoot) {
  if (declaredRoot !== repositoryRoot || fs.realpathSync(declaredRoot) !== repositoryRoot) throw new Error('repository root authority');
  if (controlRoot !== '/private/tmp/safe-bash-core70-v5-20260829/controls' || fs.realpathSync(controlRoot) !== controlRoot) throw new Error('control root authority');
  let resolved;
  if (sourcePaths.includes(member)) resolved = path.join(repositoryRoot, member);
  else if (copyNames.some(name => member === path.join(controlRoot, name))) resolved = member;
  else throw new Error('inventory path not declared');
  for (let current = resolved; current !== path.dirname(current); current = path.dirname(current)) {
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('inventory symlink');
  }
  return resolved;
}
