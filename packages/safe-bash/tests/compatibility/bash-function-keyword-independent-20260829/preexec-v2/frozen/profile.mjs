import path from 'node:path';
export const PROFILE = 'bash-surface-direct-owned-child-functional-v1';
export function validateRole(role) {
  if (role.profile !== PROFILE || role.childProcessPermission !== 0 || role.workerPermission !== 0 || role.loaderThreads !== 0 || role.loaderMode !== 'synchronous-registerHooks') throw Error('ROLE_AUTHORITY');
  if (!['harmless-control','product-case'].includes(role.kind)) throw Error('ROLE_KIND');
  for (const key of ['app','entry','guard','trace','rolePath']) if (typeof role[key] !== 'string' || !path.isAbsolute(role[key]) || role[key].includes('*')) throw Error('ROLE_PATH');
  for (const key of ['entry','guard']) if (!role[key].startsWith(role.app + path.sep)) throw Error('ROLE_APP');
  if (!Array.isArray(role.readFiles) || !role.readFiles.includes(role.rolePath) || !role.readFiles.includes(role.trace)) throw Error('ROLE_READS');
  for (const filename of role.readFiles) if (!path.isAbsolute(filename) || filename.includes('*')) throw Error('ROLE_READ_PATH');
  if (!role.files || !role.files[role.entry] || !role.edges || !Array.isArray(role.builtins)) throw Error('ROLE_BINDINGS');
  return role;
}
export function caseArguments(role) {
  validateRole(role);
  return ['--permission','--allow-fs-read=' + role.app,...role.readFiles.map(filename => '--allow-fs-read=' + filename),'--allow-fs-write=' + role.trace,'--import',role.guard,role.entry];
}
export function validateArguments(role, args, env) {
  if (JSON.stringify(args) !== JSON.stringify(caseArguments(role)) || Object.hasOwn(env,'NODE_OPTIONS') || Object.hasOwn(env,'NODE_PATH')) throw Error('CHILD_ARGUMENT_AUTHORITY');
}
export function completion(receipt, lifecycle) {
  return receipt?.profile === PROFILE && receipt.publicSettlement?.execObserved === true && receipt.publicSettlement?.disposeSettled === true && receipt.publicSettlement?.disposeRejected === false && lifecycle.exit === true && lifecycle.close === true && lifecycle.stdoutEOF === true && lifecycle.stderrEOF === true && lifecycle.capturesQualified === true && lifecycle.forced === false && lifecycle.primaryPresent === false;
}
