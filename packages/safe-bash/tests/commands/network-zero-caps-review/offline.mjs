import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

let forbiddenCalls = 0;
const forbid = () => { forbiddenCalls++; throw new Error('Ambient network/product subprocess forbidden'); };
globalThis.fetch = forbid;
for (const [target, names] of [
  [http, ['request', 'get']], [https, ['request', 'get']],
  [net, ['connect', 'createConnection']], [net.Socket.prototype, ['connect']],
  [tls, ['connect']], [dgram, ['createSocket']], [dns, ['lookup', 'resolve']],
  [childProcess, ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']],
]) for (const name of names) target[name] = forbid;
syncBuiltinESMExports();
export function assertOffline() {
  if (forbiddenCalls) throw new Error(`${forbiddenCalls} forbidden runtime calls`);
}
