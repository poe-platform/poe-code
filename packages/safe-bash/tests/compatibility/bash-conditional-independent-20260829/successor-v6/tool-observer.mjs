import cp from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dgram from 'node:dgram';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
let denied = 0;
const refuse = role => function () { denied++; console.error(JSON.stringify({ toolDenied: role })); throw Error('Unadmitted tool capability: ' + role); };
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[key] = refuse('child_process.' + key);
for (const object of [http, https]) for (const key of ['request', 'get', 'createServer']) object[key] = refuse('network.' + key);
net.connect = refuse('net.connect'); net.createConnection = refuse('net.createConnection'); dgram.createSocket = refuse('dgram');
workerThreads.Worker = class { constructor() { refuse('tool Worker')(); } };
globalThis.fetch = refuse('fetch'); syncBuiltinESMExports();
console.error(JSON.stringify({ toolObserver: 'installed', pid: process.pid, execPath: process.execPath, version: process.version }));
process.once('beforeExit', () => { console.error(JSON.stringify({ toolObserver: 'closed', denied })); if (denied) process.exitCode = 78; });

