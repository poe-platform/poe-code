import {createFsBridge} from '@poe-code/safe-fs/bridge';
import {posixPath as path} from '@poe-code/safe-fs/runtime-core';
import {native} from './native.js';

export async function discoverSkillsAsync(directories, options) {
  const fs = options.nativePaths ? options.fs : createFsBridge(options.fs, {
    cwd: options.cwd, root: '/', signal: options.signal,
    codec: {
      isEncoding: encoding => encoding === 'utf8' || encoding === 'utf-8',
      encode: text => new TextEncoder().encode(text),
      decode: bytes => new TextDecoder('utf-8', {ignoreBOM: true}).decode(bytes)
    }
  });
  const machine = new native.SkillDiscoveryMachine(), skills = [];
  for (const directory of directories) {
    options.signal?.throwIfAborted();
    let request = machine.start(path.resolve(options.cwd, directory)), folder;
    while (request.kind !== 'done') {
      if (Object.hasOwn(request, 'error')) throw new Error(request.error);
      const operation = request.kind;
      try {
        switch (operation) {
          case 'root': {
            const stat = await fs.lstat(request.path);
            request = machine.root(Boolean('isSymbolicLink' in stat ? stat.isSymbolicLink() : stat.type === 'symlink'));
            break;
          }
          case 'names': {
            const entries = await fs.readdir(request.path);
            request = machine.names(entries.map(entry => typeof entry === 'string' ? entry : entry.name));
            break;
          }
          case 'child': {
            options.signal?.throwIfAborted();
            folder = path.join(request.root, request.name);
            const stat = await fs.lstat(folder);
            request = machine.directory(Boolean('isDirectory' in stat ? stat.isDirectory() : stat.type === 'directory'));
            break;
          }
          case 'filePath': request = machine.file(path.join(folder, 'SKILL.md')); break;
          case 'file': {
            const stat = await fs.lstat(request.path);
            request = machine.regular(Boolean('isFile' in stat ? stat.isFile() : stat.type === 'file'));
            break;
          }
          case 'read': {
            const raw = await fs.readFile(request.file);
            options.signal?.throwIfAborted();
            const content = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
            skills.push({name: request.name, file: request.file, content});
            request = machine.loaded();
            break;
          }
          default: throw new Error(`Unknown native skill discovery request ${operation}`);
        }
      } catch (error) {
        if ((operation === 'root' || operation === 'names' || operation === 'file' || operation === 'read') &&
            error instanceof Error && Object.hasOwn(error, 'code') && error.code === 'ENOENT') {
          request = machine.missing();
        } else throw error;
      }
    }
  }
  return skills;
}
