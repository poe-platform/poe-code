import childProcess from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';

const append = fs.appendFileSync;
const read = fs.readFileSync;
const originalSpawn = childProcess.spawnSync;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const record = value => append(process.env.INDEPENDENT_TRACE, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), ...value }) + '\n');
record({ event: 'start', ppid: process.ppid, executable: process.execPath, version: process.version, argv: process.argv, execArgv: process.execArgv, cwd: process.cwd(), nodeOptions: process.env.NODE_OPTIONS, nodeTestContext: process.env.NODE_TEST_CONTEXT ?? null });
process.on('exit', code => record({ event: 'exit', code }));

fs.readFileSync = function(path, ...args) {
  const result = read(path, ...args);
  const name = typeof path === 'string' ? resolve(path) : path instanceof URL && path.protocol === 'file:' ? path.pathname : null;
  if (name?.startsWith(process.env.INDEPENDENT_INPUT + '/') && !name.includes('/node_modules/')) {
    const bytes = typeof result === 'string' ? Buffer.from(result) : result;
    record({ event: 'read', path: name, bytes: bytes.length, sha256: hash(bytes) });
  }
  return result;
};

function fixtureInputs(root) {
  const entries = [];
  function walk(relative) {
    for (const name of fs.readdirSync(join(root, relative)).sort()) {
      const path = relative ? `${relative}/${name}` : name, absolute = join(root, path), stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) entries.push({ path, link: fs.readlinkSync(absolute), realpath: fs.realpathSync(absolute) });
      else if (stat.isDirectory()) walk(path);
      else {
        const bytes = read(absolute);
        entries.push({ path, bytes: bytes.length, sha256: hash(bytes), base64: bytes.toString('base64') });
      }
    }
  }
  walk('');
  return entries;
}

childProcess.spawnSync = function(command, args, options) {
  const npm = command === 'npm';
  record({ event: 'spawn-before', command, args, cwd: options?.cwd ?? process.cwd(), env: options?.env ?? null, ...(npm ? { fixtureInputs: fixtureInputs(options.cwd) } : {}) });
  const result = originalSpawn.call(this, command, args, options);
  record({ event: 'spawn-after', command, args, cwd: options?.cwd ?? process.cwd(), childPid: result.pid, status: result.status, signal: result.signal, error: result.error?.message ?? null,
    stdoutBase64: result.stdout == null ? null : Buffer.from(result.stdout).toString('base64'), stderrBase64: result.stderr == null ? null : Buffer.from(result.stderr).toString('base64') });
  return result;
};
syncBuiltinESMExports();
