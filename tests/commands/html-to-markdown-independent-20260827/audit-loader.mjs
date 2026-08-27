import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';

const denied = name => () => { throw new Error('HOST_IO_DENIED:' + name); };
globalThis.fetch = denied('fetch');
for (const [name, object, methods] of [
  ['child', childProcess, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']],
  ['http', http, ['request', 'get', 'createServer']], ['https', https, ['request', 'get', 'createServer']],
  ['net', net, ['connect', 'createConnection', 'createServer']], ['tls', tls, ['connect', 'createServer']],
]) for (const method of methods) object[method] = denied(name + '.' + method);
syncBuiltinESMExports();
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.startsWith('file:')) {
      const bytes = typeof result.source === 'string' ? Buffer.from(result.source) : Buffer.from(result.source ?? []);
      process.stderr.write('LOAD ' + JSON.stringify({ url, format: result.format, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }) + '\n');
    }
    return result;
  },
});
