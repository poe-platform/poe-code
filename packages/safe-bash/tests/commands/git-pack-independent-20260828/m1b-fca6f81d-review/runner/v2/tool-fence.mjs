import childProcess from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import tls from 'node:tls';
import Module, { syncBuiltinESMExports, isBuiltin } from 'node:module';
import path from 'node:path';

const denied = () => { throw new Error('UNOWNED_PROCESS_OR_NETWORK_DENIED'); };
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[method] = denied;
net.connect = denied;
net.createConnection = denied;
net.Socket.prototype.connect = denied;
net.Server.prototype.listen = denied;
http.request = denied;
http.get = denied;
https.request = denied;
https.get = denied;
dgram.createSocket = denied;
tls.connect = denied;
globalThis.fetch = denied;
if (process.env.M1B_TOOL_ROOT) {
  const resolveFilename = Module._resolveFilename;
  Module._resolveFilename = function (specifier, ...arguments_) {
    const result = Reflect.apply(resolveFilename, this, [specifier, ...arguments_]);
    if (isBuiltin(result)) return result;
    const root = process.env.M1B_TOOL_ROOT;
    if (typeof result !== 'string' || !path.isAbsolute(result) || !(result === root || result.startsWith(root + path.sep))) denied();
    return result;
  };
}
syncBuiltinESMExports();
