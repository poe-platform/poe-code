import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Miniflare launches detached browsers with handleSIGTERM:false. An independent
// IPC owner survives even SIGKILL of a Vitest host and retires its browser groups.
// Match the launch contract, never enumerate or terminate unrelated Chrome.
const installed = Symbol.for('poe-code.native-browser-lifetime');
if (!childProcess.spawn[installed]) {
  const spawn = childProcess.spawn;
  let guardian;
  childProcess.spawn = function (command, args, options) {
    const owned = options?.detached === true && Array.isArray(args)
      && args.some(arg => arg.startsWith('--user-data-dir=') && arg.includes('/browser-rendering/profile-'));
    if (owned && process.platform === 'win32') throw new Error('Native browser lifetime tests require POSIX process groups');
    if (owned && !guardian) {
      guardian = childProcess.fork(new URL('./browser-process-lifetime.guardian.mjs', import.meta.url), [], {
        execArgv: [], detached: true, stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      });
      guardian.unref();
      guardian.channel.unref?.();
      guardian.on('error', error => { throw error; });
    }
    let directory;
    if (owned) {
      const root = fileURLToPath(new URL('../../../out/', import.meta.url));
      mkdirSync(root, { recursive: true });
      directory = mkdtempSync(root + 'native-browser-owner-');
    }
    const child = spawn.call(this, command, args, owned ? { ...options, cwd: directory } : options);
    if (owned && child.pid) {
      child[Symbol.for('poe-code.native-browser-directory')] = directory;
      guardian.send({ operation: 'own', pid: child.pid, directory });
      child.once('exit', () => guardian.send({ operation: 'retire', pid: child.pid }));
    } else if (directory) rmSync(directory, { recursive: true });
    return child;
  };
  childProcess.spawn[installed] = true;
  syncBuiltinESMExports();
}
