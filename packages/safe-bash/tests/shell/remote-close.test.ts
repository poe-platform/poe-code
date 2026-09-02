import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runRemoteCloseChild } from "./remote-close-child.js";

for (const scenario of [
  "transport", "pipefail", "middle", "middle-status", "nested-invoke", "redirect", "group",
  "consumer-rejection", "consumer-status",
  "late-read-rejection", "iterator-return", "caller-abort", "budget-abort",
  "completed-success", "completed-failure", "completed-rejection", "delayed-no-write",
  "closed-before-write", "zero-byte-no-write",
  "first-read-head-zero", "first-read-local-unenrolled-controlled", "first-read-local-owned",
  "first-read-s3", "first-read-webdav", "first-read-curl-body", "first-read-curl-headers",
  "first-read-webdav-body-acquired", "first-read-curl-body-acquired", "first-read-required-destinations",
]) {
  test(`hard-deadline pipeline close: ${scenario}`, async context => {
    const result = await runRemoteCloseChild(["--unhandled-rejections=strict", "--import", "tsx",
      fileURLToPath(new URL(scenario.startsWith("first-read-") ? "./first-read-probe.ts" : "./remote-close-probe.ts", import.meta.url)), scenario]);
    const { pid, status, signal, timedOut, oversized, residual, residualAtClose, closeElapsedMs, elapsedMs, stdout, stderr } = result;
    context.diagnostic(JSON.stringify({ scenario, pid, status, signal, timedOut, oversized, residual, residualAtClose, closeElapsedMs, elapsedMs,
      ...(scenario.startsWith("first-read-") ? { stdout, stderr } : {}),
    }));
    assert.equal(residual, false, `${scenario}: residual child process group was stopped`);
    assert.equal(timedOut, false, `${scenario}: hard 3000ms deadline; ${stderr}`);
    assert.equal(oversized, false, `${scenario}: output exceeded 1 MiB`);
    assert.equal(result.signal, null, `${scenario}: child terminated by ${result.signal}`);
    assert.equal(result.status, 0, `${scenario}: ${stderr}`);
    assert.match(stdout, /: passed/u);
  });
}

function descendantArgs(parentDelay: number, descendantDelay: number): string[] {
  return ["--input-type=module", "--eval", `
    import { spawn } from 'node:child_process';
    import { once } from 'node:events';
    import { setTimeout as delay } from 'node:timers/promises';
    const descendant = spawn(process.execPath, ['--eval', 'setTimeout(() => {}, ${descendantDelay})'], { stdio: 'ignore' });
    await once(descendant, 'spawn');
    console.log(descendant.pid);
    descendant.unref();
    await delay(${parentDelay});
  `];
}

test("remote-close supervisor permits natural descendant retirement within the original deadline", { skip: process.platform === "win32" ? "POSIX process-group control" : false }, async context => {
  const sendSignal = process.kill.bind(process);
  let releasedGroup: number | undefined;
  const kill = context.mock.method(process, "kill", (...args: Parameters<typeof process.kill>) => {
    const result = sendSignal(...args);
    if (args[0] < 0 && args[1] === 0 && releasedGroup === undefined) {
      releasedGroup = args[0];
      assert.equal(sendSignal(releasedGroup, "SIGUSR1"), true);
    }
    return result;
  });
  const descendantSource = `
    const keepAlive = setInterval(() => {}, 1000);
    process.once('SIGUSR1', () => clearInterval(keepAlive));
    process.send('ready', () => process.disconnect());
  `;
  const result = await runRemoteCloseChild(["--input-type=module", "--eval", `
    import assert from 'node:assert/strict';
    import { spawn } from 'node:child_process';
    import { once } from 'node:events';
    const descendant = spawn(process.execPath, ['--eval', ${JSON.stringify(descendantSource)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const [ready] = await once(descendant, 'message');
    assert.equal(ready, 'ready');
    console.log(descendant.pid);
    descendant.unref();
  `]);
  context.diagnostic(JSON.stringify(result));
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.residualAtClose, true);
  assert.equal(releasedGroup, -result.pid!);
  assert.equal(result.residual, false);
  assert.equal(result.timedOut, false);
  assert.equal(result.oversized, false);
  assert.equal(result.stderr, "");
  assert.ok(Number(result.stdout.trim()) > 0);
  assert.ok(!kill.mock.calls.some(call => call.arguments[1] === "SIGKILL"));
  assert.throws(() => process.kill(-result.pid!, 0), { code: "ESRCH" });
});

test("remote-close supervisor rejects lingering descendants without resetting the three-second deadline", { skip: process.platform === "win32" ? "POSIX process-group control" : false }, async context => {
  const kill = context.mock.method(process, "kill");
  const result = await runRemoteCloseChild(descendantArgs(1000, 10000));
  context.diagnostic(JSON.stringify(result));
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(result.residualAtClose, true);
  assert.equal(result.residual, true);
  assert.equal(result.timedOut, true);
  assert.equal(result.oversized, false);
  assert.ok(result.closeElapsedMs >= 900);
  assert.ok(result.elapsedMs < 3800, `original total deadline, not a new post-close deadline: ${result.elapsedMs}`);
  const stops = kill.mock.calls.filter(call => call.arguments[0] === -result.pid! && call.arguments[1] === "SIGKILL");
  assert.equal(stops.length, 1);
  assert.equal(stops[0]?.result, true);
});
