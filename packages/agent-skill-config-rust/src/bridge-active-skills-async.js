import {Buffer} from 'node:buffer';
import {createFsBridge} from '@poe-code/safe-fs/bridge';
import {posixPath as path} from '@poe-code/safe-fs/runtime-core';
import {native} from './native.js';
import {resolveSkillDir} from './configs.js';
import {resolveSkillReferenceAsync} from './resolve-skill-reference-async.js';
import {appendExcludeBlockAsync, removeExcludeBlockAsync} from './git-exclude-async.js';

const providers = new WeakMap(), manifests = new WeakMap();
async function exclusive(fs, action) {
  let state = providers.get(fs);
  if (!state) {
    state = {engine: new native.SkillAsyncBridge(), queue: Promise.resolve(), manifests: new Map()};
    providers.set(fs, state);
  }
  const result = state.queue.then(() => action(state.engine));
  state.queue = result.catch(() => undefined);
  return result;
}

async function drive(machine, options, context) {
  const errors = [], filesystems = [], collections = new Map();
  let collectionId = 0, released, releaseEntry;
  let request = machine.start();
  while (request.kind === 'request') {
    const args = request.args, io = filesystems[request.io];
    let result = null;
    try {
      switch (request.operation) {
        case 'acquire': {
          const selected = args[0] ? {...options, signal: undefined} : options;
          const fs = createFsBridge(selected.fs, {
            cwd: selected.cwd, root: '/', signal: selected.signal,
            codec: {
              isEncoding: encoding => encoding === 'utf8' || encoding === 'utf-8',
              encode: text => new TextEncoder().encode(text),
              decode: bytes => new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes)
            }
          });
          result = filesystems.push({fs, options: selected}) - 1;
          await Promise.resolve();
          break;
        }
        case 'resolveRefs': result = await Promise.all(context.refs.map(ref => resolveSkillReferenceAsync(ref, options))); break;
        case 'uuid': result = crypto.randomUUID(); break;
        case 'manifest': {
          const manifest = {bridgeId: args[0], spawnAgentId: args[1], cwd: options.cwd, runId: args[2], entries: [], warnings: []};
          const state = {fs: options.fs, cleaned: false, entries: manifest.entries};
          manifests.set(manifest, state);
          context.manifest = manifest; context.state = state;
          break;
        }
        case 'skillPath': result = path.join(resolveSkillDir(args[0], args[1], options.cwd, options.homeDir, path), args[2]); break;
        case 'join': result = path.join(...args); break;
        case 'dirname': result = path.dirname(args[0]); break;
        case 'existsStat': await io.fs.lstat(args[0]); break;
        case 'symbolic': result = Boolean((await io.fs.lstat(args[0])).isSymbolicLink()); break;
        case 'kind': {
          const stat = await io.fs.lstat(args[0]);
          result = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other';
          break;
        }
        case 'names': result = await io.fs.readdir(args[0]); break;
        case 'readBytes': {
          const bytes = await io.fs.readFile(args[0]);
          request = machine.bytes(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
          continue;
        }
        case 'readText': result = await io.fs.readFile(args[0], 'utf8'); break;
        case 'mkdir': if (args[1]) await io.fs.mkdir(args[0], {recursive: true}); else await io.fs.mkdir(args[0]); break;
        case 'readEntries': {
          const entries = await io.fs.readdir(args[0], {withFileTypes: true}), iterator = entries[Symbol.iterator]();
          result = collectionId++;
          collections.set(result, {iterator, next: iterator.next, inBody: false});
          break;
        }
        case 'copyEntry': {
          const current = collections.get(args[0]);
          current.inBody = false;
          const item = Reflect.apply(current.next, current.iterator, []);
          if (item.done) {collections.delete(args[0]); break;}
          const entry = item.value;
          current.inBody = true;
          const from = path.join(args[1], entry.name), to = path.join(args[2], entry.name);
          result = {from, to, kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other'};
          break;
        }
        case 'closeEntries': {
          const current = collections.get(args[0]);
          collections.delete(args[0]);
          if (current?.inBody) {
            const close = current.iterator.return;
            if (close != null) Reflect.apply(close, current.iterator, []);
          }
          break;
        }
        case 'copyFile': await io.fs.copyFile(...args); break;
        case 'writeToken': await io.fs.writeFile(args[0], args[1], {encoding: 'utf8', flag: 'wx'}); break;
        case 'removeTree': await io.fs.rm(args[0], {recursive: true, force: true}); break;
        case 'rmdir': await io.fs.rmdir(args[0]); break;
        case 'admit': {
          const error = Object.hasOwn(args[0], 'foreignError') ? errors[args[0].foreignError] : new Error(args[0].error);
          io.options.signal?.throwIfAborted();
          result = args[1].some(code => error instanceof Error && Object.hasOwn(error, 'code') && error.code === code);
          break;
        }
        case 'entry': context.manifest.entries.push(args[0]); break;
        case 'warning': context.manifest.warnings.push(args[0]); break;
        case 'excludePaths': result = context.manifest.entries.map(entry => path.relative(options.cwd, entry.targetPath)); break;
        case 'appendExclude': result = await appendExcludeBlockAsync(options, args[0], args[1]) ?? null; break;
        case 'complete':
          context.state.blockId = args[0] ?? undefined;
          if (context.state.blockId) context.manifest.excludeBlockId = context.state.blockId;
          providers.get(options.fs).manifests.set(context.manifest.bridgeId, context.state);
          break;
        case 'blockId': result = context.state.blockId ?? null; break;
        case 'removeExclude': await removeExcludeBlockAsync(options, args[0]); break;
        case 'releaseStart': released = [...context.state.entries].reverse()[Symbol.iterator](); break;
        case 'releaseNext': {
          const item = released.next();
          if (!item.done) {releaseEntry = item.value; result = releaseEntry.targetPath;}
          break;
        }
        case 'releasePath': result = releaseEntry.targetPath; break;
        case 'cleaned':
          context.state.cleaned = true;
          if (context.manifest.bridgeId) providers.get(options.fs).manifests.delete(context.manifest.bridgeId);
          break;
        default: throw new Error(`Unknown native async bridge request ${request.operation}`);
      }
    } catch (error) {
      request = machine.failure(errors.push(error) - 1);
      continue;
    }
    request = machine.value(JSON.stringify(result));
  }
  if (Object.hasOwn(request, 'foreignError')) throw errors[request.foreignError];
  if (Object.hasOwn(request, 'error')) throw new Error(request.error);
  return context.manifest;
}
export async function bridgeActiveSkillsAsync(spawnAgentId, refs, runId, options) {
  return exclusive(options.fs, engine => drive(engine.begin(spawnAgentId, runId), options, {refs}));
}
export async function cleanupBridgedSkillsAsync(manifest, options) {
  const original = manifests.get(manifest);
  if (original && original.fs !== options.fs) throw new Error('Bridge manifest filesystem conflicts with cleanup filesystem');
  await exclusive(options.fs, async engine => {
    const state = original ?? (manifest.bridgeId ? providers.get(options.fs).manifests.get(manifest.bridgeId) : undefined);
    if (!state || state.cleaned) return;
    await drive(engine.cleanup(), options, {manifest, state});
  });
}
