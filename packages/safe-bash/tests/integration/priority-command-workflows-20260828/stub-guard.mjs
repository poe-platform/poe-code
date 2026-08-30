import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const deny = () => { throw new Error('HOST_CAPABILITY_REFUSED'); };
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[key] = deny;
for (const owner of [http, https]) for (const key of ['request', 'get']) owner[key] = deny;
net.connect = deny; net.createConnection = deny; tls.connect = deny; globalThis.fetch = deny;
syncBuiltinESMExports();
