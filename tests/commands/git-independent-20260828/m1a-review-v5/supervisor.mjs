import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { HERE, now, need, sha, put } from './common.mjs';

export function supervisor(binding, receipt, captureRoot) {
  let outputBytes = 0, allocated = 0, active = 0;
  const reserve = count => { need(Number.isSafeInteger(count) && count >= 0, 'capture byte count'); allocated += count; need(allocated <= 120 * 1024 * 1024, 'capture cap with8MiB metadata reserve'); };
  return async function child(label, packet, timeoutMs = 120000) {
    need(now() + timeoutMs + 5000 < binding.measuredDeadlineMs, 'aggregate monotonic deadline reserves cleanup');
    need(++active === 1 && receipt.children.length < 17, 'one sequential child, seventeen total');
    const packetPath = path.join(captureRoot, label + '-packet.json');
    await put(packetPath, JSON.stringify(packet, null, 2) + '\n');
    const row = { label, born: null, pid: null, pgid: null, startMonotonicMs: now(), executable: binding.node, args: [path.join(HERE, 'child.mjs'), packetPath], signals: [], messages: [], closed: false, bytes: 0 };
    receipt.children.push(row);
    const child = spawn(binding.node.path, row.args, { cwd: HERE, detached: true, env: { PATH: path.dirname(binding.node.path), HOME: captureRoot, TMPDIR: captureRoot, UV_THREADPOOL_SIZE: '1', NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    row.pid = child.pid;
    const stdout = [], stderr = []; let fatal, escalation;
    const stop = reason => {
      if (fatal) return; fatal = reason;
      if (!row.closed) { row.signals.push({ signal: 'SIGTERM', identity: 'owned live ChildProcess handle', pid: child.pid, born: row.born }); child.kill('SIGTERM'); }
      escalation = setTimeout(() => { if (!row.closed) { row.signals.push({ signal: 'SIGKILL', identity: 'same unclosed owned handle', pid: child.pid, born: row.born }); child.kill('SIGKILL'); } }, 1000);
    };
    const timer = setTimeout(() => stop('CHILD_DEADLINE'), timeoutMs);
    child.on('error', error => stop('SPAWN_ERROR:' + error.message));
    child.on('message', message => {
      try {
        need(message && typeof message === 'object', 'IPC shape');
        if (message.kind === 'birth') {
          need(row.born === null && message.pid === child.pid && message.ppid === process.pid && message.pgid === child.pid && /^[0-9]+$/.test(message.born), 'owned child birth/group handshake');
          row.born = message.born; row.pgid = message.pgid; child.send({ kind: 'admit' });
        } else if (message.kind === 'reserve') { reserve(message.bytes); child.send({ kind: 'reserved', token: message.token }); }
        else { row.messages.push(message); if (message.kind === 'case' && message.status === 'FAIL') console.log(JSON.stringify({ phase: label, id: message.id, candidate: binding.source, failure: message.message, safety: message.safety })); if (message.kind === 'case' && message.safety) stop('CASE_SAFETY_STOP'); }
      } catch (error) { stop('IPC_OR_CAPTURE:' + error.message); }
    });
    for (const [stream, pieces] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', bytes => {
      row.bytes += bytes.length; outputBytes += bytes.length;
      if (row.bytes > 8 * 1024 * 1024 || outputBytes > 16 * 1024 * 1024) stop('STDIO_CAPTURE_BOUND');
      else { try { reserve(bytes.length); pieces.push(Buffer.from(bytes)); } catch (error) { stop(error.message); } }
    });
    const closed = await Promise.race([
      new Promise(resolve => child.once('close', (code, signal) => { row.closed = true; resolve({ code, signal }); })),
      new Promise(resolve => { const guard = setTimeout(() => resolve({ reapUnknown: true }), timeoutMs + 5000); child.once('close', () => clearTimeout(guard)); }),
    ]);
    clearTimeout(timer); clearTimeout(escalation); active--;
    Object.assign(row, closed, { fatal, elapsedMs: now() - row.startMonotonicMs, captureAllocated: allocated });
    await put(path.join(captureRoot, label + '.stdout'), Buffer.concat(stdout)); await put(path.join(captureRoot, label + '.stderr'), Buffer.concat(stderr));
    await put(path.join(captureRoot, label + '.status.json'), JSON.stringify(row, null, 2) + '\n');
    need(row.closed && !closed.reapUnknown && !fatal, `fatal child safety/cleanup: ${label}: ${fatal ?? 'unknown reap'}`);
    need(row.born !== null, 'birth admission established');
    return { row, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) };
  };
}
