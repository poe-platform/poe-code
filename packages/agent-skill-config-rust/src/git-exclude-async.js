import {createFsBridge} from '@poe-code/safe-fs/bridge';
import {posixPath as path} from '@poe-code/safe-fs/runtime-core';
import {native} from './native.js';

const pendingMutations = new WeakMap();
function assertSingleLine(value, label) {
  const error = native.skillExcludeLineError(value, label);
  if (error !== null) throw new Error(error);
}
async function mutateExclude(options, runId, entries, prefix, remove) {
  const result = (pendingMutations.get(options.fs) ?? Promise.resolve()).then(async () => {
    const machine = new native.SkillExcludeMachine(runId, prefix, remove);
    let fs = createFsBridge(options.fs, {
      cwd: options.cwd, root: '/', signal: options.signal,
      codec: {
        isEncoding: encoding => encoding === 'utf8' || encoding === 'utf-8',
        encode: text => new TextEncoder().encode(text),
        decode: bytes => new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes)
      }
    });
    let request = machine.start(options.cwd), failure;
    while (request.kind !== 'done') {
      if (Object.hasOwn(request, 'error')) throw new Error(request.error);
      try {
        switch (request.kind) {
          case 'join': request = machine.path(path.join(...request.parts)); break;
          case 'resolve': request = machine.path(path.resolve(request.directory, request.target)); break;
          case 'parent': request = machine.path(path.dirname(request.path)); break;
          case 'gitStat': {
            const stat = await fs.lstat(request.path), symbolic = stat.isSymbolicLink();
            request = machine.stat(Boolean(symbolic), symbolic ? false : Boolean(stat.isDirectory()));
            break;
          }
          case 'gitRead': case 'read': request = machine.content(await fs.readFile(request.path, 'utf8')); break;
          case 'acquire':
            fs = createFsBridge(options.fs, {
              cwd: options.cwd, root: '/', signal: options.signal,
              codec: {
                isEncoding: encoding => encoding === 'utf8' || encoding === 'utf-8',
                encode: text => new TextEncoder().encode(text),
                decode: bytes => new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes)
              }
            });
            request = machine.advance();
            break;
          case 'entries': request = machine.entries([...entries].map(value => value === null || value === undefined ? '' : `${value}`)); break;
          case 'inspect': request = machine.stat(Boolean((await fs.lstat(request.path)).isSymbolicLink()), false); break;
          case 'mkdir': await fs.mkdir(request.path, {recursive: true}); request = machine.advance(); break;
          case 'temporary': request = machine.path(`${request.path}.${crypto.randomUUID()}.tmp`); break;
          case 'write': await fs.writeFile(request.path, request.content, {encoding: 'utf8', flag: 'wx'}); request = machine.advance(); break;
          case 'rename': await fs.rename(request.from, request.to); request = machine.advance(); break;
          case 'cleanup': await fs.rm(request.path, {force: true}); request = machine.advance(); break;
          default: throw new Error(`Unknown native async exclude request ${request.kind}`);
        }
      } catch (error) {
        if (machine.admitsMissing() && error instanceof Error && Object.hasOwn(error, 'code') && error.code === 'ENOENT') {
          request = machine.missing();
        } else {
          const recovery = machine.failed();
          if (recovery === null) throw error;
          failure = {error};
          request = recovery;
        }
      }
    }
    if (failure) throw failure.error;
    return request.block ?? undefined;
  });
  pendingMutations.set(options.fs, result.catch(() => undefined));
  return result;
}
export async function appendExcludeBlockAsync(options, runId, entries, opts) {
  const prefix = opts?.markerPrefix ?? 'poe-code-spawn-skills';
  assertSingleLine(runId, 'runId');
  assertSingleLine(prefix, 'markerPrefix');
  for (const entry of entries) assertSingleLine(entry, 'exclude entry');
  return mutateExclude(options, runId, entries, prefix, false);
}
export async function removeExcludeBlockAsync(options, runId, opts) {
  const prefix = opts?.markerPrefix ?? 'poe-code-spawn-skills';
  assertSingleLine(runId, 'runId');
  assertSingleLine(prefix, 'markerPrefix');
  await mutateExclude(options, runId, undefined, prefix, true);
}
