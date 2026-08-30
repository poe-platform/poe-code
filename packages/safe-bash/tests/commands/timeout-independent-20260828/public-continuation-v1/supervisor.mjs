import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { node, fileHash, save, write, reason } from './common.mjs';
export function absent(pid) {
  for (const target of [pid, -pid]) { let caught; try { process.kill(target, 0); } catch (error) { caught = error; } assert.equal(caught?.code, 'ESRCH', `CHILD_NOT_REAPED:${target}`); }
}
export function supervisor({ raw, work, guard, children }) {
  const environment = { PATH: '/usr/bin:/bin', HOME: resolve(work,'home'), TMPDIR: resolve(work,'tmp'), LC_ALL: 'C', LANG: 'C', NODE_NO_WARNINGS: '1', npm_config_cache: resolve(work,'npm-cache'), npm_config_userconfig: resolve(work,'empty-npmrc'), npm_config_globalconfig: resolve(work,'empty-global-npmrc'), npm_config_update_notifier: 'false' };
  for (const target of [environment.HOME, environment.TMPDIR]) fs.mkdirSync(target, { recursive: true });
  write(environment.npm_config_userconfig, ''); write(environment.npm_config_globalconfig, '');
  return async function child(label, args, cwd, extra = {}, milliseconds = 10000) {
    guard(`${label}:PRE`);
    const directory = resolve(raw, `${String(children.length + 1).padStart(3,'0')}-${label}`); fs.mkdirSync(directory);
    const record = { label, args, cwd, startedAt: new Date().toISOString(), nodeSha256: fileHash(node), environment: { ...environment, ...extra }, forced: false, bytes: 0 };
    children.push(record); save(resolve(directory,'PRE.json'), record);
    const handle = spawn(node, args, { cwd, env: record.environment, detached: true, stdio: ['ignore','pipe','pipe'] }); record.pid = handle.pid;
    const stdout = [], stderr = []; let escalation;
    const kill = cause => { if (record.forced) return; record.forced = cause; if (record.pid) { try { process.kill(-record.pid, 'SIGTERM'); } catch {} escalation = setTimeout(() => { try { process.kill(-record.pid, 'SIGKILL'); } catch {} }, 2000); } };
    for (const [stream, rows] of [[handle.stdout,stdout],[handle.stderr,stderr]]) stream.on('data', bytes => { record.bytes += bytes.length; if (record.bytes > 16 * 1024 ** 2) kill('OUTPUT_LIMIT'); else rows.push(Buffer.from(bytes)); });
    const timer = setTimeout(() => kill('WATCHDOG'), milliseconds);
    await new Promise(done => { handle.on('error', error => { record.spawnError = reason(error); }); handle.on('exit', (code,signal) => { record.exit = { code, signal }; }); handle.on('close', (code,signal) => { record.close = { code, signal }; clearTimeout(timer); clearTimeout(escalation); done(); }); });
    write(resolve(directory,'stdout.data'), Buffer.concat(stdout)); write(resolve(directory,'stderr.data'), Buffer.concat(stderr));
    if (record.pid) { absent(record.pid); record.reaped = true; }
    record.finishedAt = new Date().toISOString(); save(resolve(directory,'STATUS.json'), record);
    guard(`${label}:POST`); assert.equal(fileHash(node), record.nodeSha256); assert.equal(record.forced, false, 'FORCED_CHILD_NOT_A_PASS'); assert.equal(record.spawnError, undefined); assert.deepEqual(record.exit, record.close);
    return { ...record.close, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), directory };
  };
}
