import { isDeepStrictEqual } from 'node:util';
import { sha256 } from './support.mjs';

export function strictTuple(expected, actual) {
  return ['stdout', 'stderr', 'status', 'effects'].every(field => isDeepStrictEqual(expected[field], actual[field]));
}
export function pinned(value, expectedHash) { return sha256(JSON.stringify(value)) === expectedHash; }
export function profileIdentity(expected, actual) {
  return ['profile', 'source', 'role', 'commandName', 'locale', 'args'].every(field => isDeepStrictEqual(expected[field], actual[field]));
}
export function safePluginTuple(id, cwd) {
  const outputs = {
    'closure/query-V-verbose': `printf is a registered command\nclosurefn is a function\nclosurefn () \n{ \n    :\n}\nclosuretool is ${cwd}/tools/closuretool\n`,
    'closure/type-multiple-status': 'command\nfunction\nfile\nmixed:1\nprintf is a registered command\nclosuretool is tools/closuretool\n',
    'control/registry-truth': 'true is a shell builtin\nprintf is a registered command\nbuiltin\ncommand\n',
  };
  if (!(id in outputs)) throw new Error('Not an independently declared safe-plugin classification control');
  return { stdout: Buffer.from(outputs[id]).toString('base64'), stderr: '', status: 0 };
}
export function registryTruth(id, cwd, actual, metadata) {
  const expected = safePluginTuple(id, cwd);
  return metadata.printfRegistered === true && Object.keys(expected).every(field => isDeepStrictEqual(actual[field], expected[field]));
}
