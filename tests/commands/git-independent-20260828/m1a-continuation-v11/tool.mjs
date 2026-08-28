import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

const packet = JSON.parse(readFileSync(process.argv[2]));
const hash = value => createHash('sha256').update(value).digest('hex');
assert.equal(process.execPath, packet.node.path); assert.equal(hash(readFileSync(packet.entry)), packet.entrySha256);
const receipt = { pid: process.pid, ppid: process.ppid, entry: packet.entry, entrySha256: packet.entrySha256, nestedProcessAttempts: 0, networkAttempts: 0 };
for (const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork']) childProcess[key] = () => {
  receipt.nestedProcessAttempts++; throw new Error('UNDECLARED_NESTED_CHILD_REFUSED');
};
const deny = () => { receipt.networkAttempts++; throw new Error('NETWORK_REFUSED'); };
net.connect = deny; net.createConnection = deny; net.Socket.prototype.connect = deny; tls.connect = deny;
http.request = deny; http.get = deny; https.request = deny; https.get = deny;
syncBuiltinESMExports();
process.once('exit', code => { receipt.exitCode = code; writeFileSync(packet.receipt, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' }); });
console.log(JSON.stringify({ kind: 'birth', pid: process.pid, ppid: process.ppid, role: packet.role }));
process.argv = [process.execPath, packet.entry, ...packet.args];
createRequire(import.meta.url)(packet.entry);
