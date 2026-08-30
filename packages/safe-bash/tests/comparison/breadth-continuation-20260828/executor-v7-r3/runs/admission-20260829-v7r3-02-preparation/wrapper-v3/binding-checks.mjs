import path from 'node:path';
import { own } from './owner-schema-helper.mjs';
export function validateBinding(input) {
  own(input, ['owner', 'capture', 'oldOwner', 'oldCapture', 'home', 'expectedHome', 'runId', 'authPath', 'grantPath', 'capturePath', 'outputRoot', 'executor']);
  const before = "const runId = 'admission-20260829-v7r3-01';";
  const after = "const runId = 'admission-20260829-v7r3-02';";
  if (typeof input.owner !== 'string' || typeof input.oldOwner !== 'string' || input.oldOwner.split(before).length !== 2 || input.owner !== input.oldOwner.replace(before, after) || input.capture !== input.oldCapture) throw Error('INSTANCE_SOURCE_DELTA');
  if (input.home !== input.expectedHome || path.resolve(input.home, '../../..') !== input.executor || input.runId !== 'admission-20260829-v7r3-02' || input.authPath !== path.resolve(input.home, '../activation/AUTH.json') || input.grantPath !== path.resolve(input.home, '../activation/ROOT-GRANT.json') || input.capturePath !== path.join(input.home, 'actual-capture') || input.outputRoot !== path.join(input.executor, 'runs', input.runId)) throw Error('INSTANCE_ROUTE');
  return true;
}
export function validateTemplate(grant, auth, expected) {
  own(grant, Object.keys(expected.grant)); own(auth, ['review', 'grant']);
  own(grant.command, ['entry', 'phase', 'runId', 'nodeArgs']); own(auth.review, ['commit', 'path', 'sha256']); own(auth.grant, ['commit', 'path', 'sha256']);
  if (JSON.stringify(grant) !== JSON.stringify(expected.grant) || JSON.stringify(auth) !== JSON.stringify(expected.auth)) throw Error('INACTIVE_TEMPLATE_VALUE');
  return true;
}
export function assertUnused(paths, exists) {
  if (!Array.isArray(paths) || paths.length !== 5 || paths.some(value => typeof value !== 'string' || exists(value))) throw Error('INSTANCE_NAMESPACE_USED');
  return true;
}
