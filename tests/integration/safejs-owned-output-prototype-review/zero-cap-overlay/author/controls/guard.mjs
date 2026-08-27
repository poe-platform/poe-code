import assert from "node:assert/strict";
import childProcess from "node:child_process";
import workerThreads from "node:worker_threads";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import dgram from "node:dgram";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import timers from "node:timers";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fs.realpathSync(process.env.SURFACE_ROOT);
const append = fs.appendFileSync;
const log = resolve(root, "logs", `${process.env.LIFECYCLE_ROW}.guard.ndjson`);
const failures = [];
const activeTimers = new Set();
const timerRequests = [];
const fail = (operation, target) => {
  const entry = { operation, target: String(target ?? ""), pid: process.pid };
  failures.push(entry);
  append(log, JSON.stringify(entry) + "\n");
  throw new Error(`Lifecycle containment refused ${operation}: ${entry.target}`);
};
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = (...args) => fail(`process.${name}`, args[0]);
workerThreads.Worker = class { constructor(...args) { fail("Worker", args[0]); } };
for (const [target, names, prefix] of [
  [net, ["connect", "createConnection", "createServer"], "net"], [tls, ["connect", "createServer"], "tls"],
  [http, ["request", "get", "createServer"], "http"], [https, ["request", "get", "createServer"], "https"],
  [dgram, ["createSocket"], "dgram"], [dns, ["lookup", "resolve", "resolve4", "resolve6"], "dns"],
  [dnsPromises, ["lookup", "resolve", "resolve4", "resolve6"], "dns.promises"],
]) for (const name of names) target[name] = (...args) => fail(`${prefix}.${name}`, args[0]);
globalThis.fetch = (...args) => fail("fetch", args[0]);
net.Socket.prototype.connect = (...args) => fail("Socket.connect", args[0]);
net.Server.prototype.listen = (...args) => fail("Server.listen", args[0]);
function filename(value, operation, write = false) {
  if (typeof value === "number") { if (![0, 1, 2].includes(value)) fail(operation, "untracked descriptor"); return; }
  const requested = value instanceof URL ? fileURLToPath(value) : Buffer.isBuffer(value) ? value.toString() : value;
  assert.equal(typeof requested, "string");
  const absolute = resolve(requested);
  if (!absolute.startsWith(root + "/")) fail(operation, absolute);
  if (write && !absolute.startsWith(resolve(root, "logs") + "/") && !absolute.startsWith(resolve(root, "tmp") + "/")) fail(operation, absolute);
}
for (const name of ["writeFileSync", "appendFileSync", "mkdirSync", "rmSync", "unlinkSync", "rmdirSync", "truncateSync", "chmodSync", "chownSync", "utimesSync"]) {
  const original = fs[name];
  fs[name] = (target, ...args) => { filename(target, name, true); return Reflect.apply(original, fs, [target, ...args]); };
}
for (const target of [fs, fsPromises]) for (const name of ["writeFile", "appendFile", "mkdir", "rm", "unlink", "rmdir", "truncate", "chmod", "chown", "utimes"]) {
  const original = target[name];
  if (original) target[name] = (file, ...args) => { filename(file, name, true); return Reflect.apply(original, target, [file, ...args]); };
}
for (const target of [fs, fsPromises]) for (const name of ["symlink", "symlinkSync", "link", "linkSync", "rename", "renameSync", "copyFile", "copyFileSync", "cp", "cpSync"]) {
  if (target[name]) target[name] = (...args) => fail(name, args[0]);
}
for (const [target, name] of [[fs, "open"], [fs, "openSync"], [fsPromises, "open"]]) {
  const original = target[name];
  target[name] = (file, flags, ...args) => {
    filename(file, name, !(flags === undefined || flags === "r" || flags === fs.constants.O_RDONLY));
    return Reflect.apply(original, target, [file, flags, ...args]);
  };
}
for (const name of ["createWriteStream", "createReadStream", "readFile", "readFileSync"]) {
  const original = fs[name];
  fs[name] = (file, ...args) => { filename(file, name, name === "createWriteStream"); return Reflect.apply(original, fs, [file, ...args]); };
}
const promiseRead = fsPromises.readFile;
fsPromises.readFile = (file, ...args) => { filename(file, "promises.readFile"); return Reflect.apply(promiseRead, fsPromises, [file, ...args]); };
for (const [setName, clearName] of [["setTimeout", "clearTimeout"], ["setInterval", "clearInterval"], ["setImmediate", "clearImmediate"]]) {
  const originalSet = timers[setName];
  const originalClear = timers[clearName];
  const wrappedSet = (callback, ...args) => {
    assert.ok(timerRequests.length < 512);
    timerRequests.push({ operation: setName, delay: args[0] });
    let handle;
    handle = originalSet((...values) => { if (setName !== "setInterval") activeTimers.delete(handle); callback(...values); }, ...args);
    activeTimers.add(handle);
    return handle;
  };
  const wrappedClear = handle => { activeTimers.delete(handle); return originalClear(handle); };
  timers[setName] = globalThis[setName] = wrappedSet;
  timers[clearName] = globalThis[clearName] = wrappedClear;
}
syncBuiltinESMExports();
export const guardState = () => ({ failures: [...failures], activeTimers: activeTimers.size, timerRequests: [...timerRequests], workersCreated: 0, subprocessesCreated: 0, socketsCreated: 0 });
