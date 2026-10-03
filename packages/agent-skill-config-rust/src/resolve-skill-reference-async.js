import {createFsBridge} from '@poe-code/safe-fs/bridge';
import {posixPath as path} from '@poe-code/safe-fs/runtime-core';
import {native} from './native.js';

export async function resolveSkillReferenceAsync(ref, options) {
  options.signal?.throwIfAborted();
  const errors = [];
  const plan = native.skillResolvePlan(ref, options.cwd, options.homeDir, (operation, args) => {
    try {return JSON.stringify(path[operation](...args));}
    catch (error) {return JSON.stringify({error: errors.push(error) - 1});}
  });
  if (Object.hasOwn(plan, 'foreignError')) throw errors[plan.foreignError];
  if (Object.hasOwn(plan, 'result')) return plan.result;
  const fs = createFsBridge(options.fs, {
    cwd: options.cwd, root: '/', signal: options.signal,
    codec: {
      isEncoding: encoding => encoding === 'utf8' || encoding === 'utf-8',
      encode: text => new TextEncoder().encode(text),
      decode: bytes => new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes)
    }
  });
  for (const candidate of plan.candidates) {
    try {
      if ((await fs.stat(candidate.path)).isDirectory()) return candidate.result;
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!(error instanceof Error && Object.hasOwn(error, 'code') && error.code === 'ENOENT') &&
          !(error instanceof Error && Object.hasOwn(error, 'code') && error.code === 'ENOTDIR')) throw error;
    }
  }
  return plan.missing;
}
