import http from "node:http";
import https from "node:https";
import net from "node:net";
import dgram from "node:dgram";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

const deny = () => { throw new Error("Author zero-cap replay forbids host networking/processes"); };
http.request = http.get = https.request = https.get = deny;
net.connect = net.createConnection = net.Socket.prototype.connect = deny;
dgram.createSocket = deny;
globalThis.fetch = deny;
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = deny;
syncBuiltinESMExports();
