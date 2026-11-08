import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";
import type { ShellCommandContext } from "../../../../src/shell/types.js";
import { MemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { basicCommands } from "../../../../src/commands/basic.js";
import { trapExtension, type TrapSignalHost } from "../../../../src/shell/extensions/trap/index.js";

function fixture() {
  const subscriptions: { deliver: (signal: string | number) => boolean; scope: object; closed: number }[] = [];
  const host: TrapSignalHost = { subscribe(deliver, scope) {
    const subscription = { deliver, scope, closed: 0 };
    subscriptions.push(subscription);
    return () => { subscription.closed++; };
  } };
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [trapExtension({ signalHost: host })] });
  for (const command of basicCommands()) shell.register(command);
  return { shell, subscriptions };
}

test("virtual signals are explicit, coalesced and delivered at a safe point", async context => {
  const { shell, subscriptions } = fixture();
  context.after(() => shell.dispose());
  shell.register({ name: "deliver", execute() {
    const receiver = subscriptions[0]!;
    assert.equal(receiver.deliver("USR1"), true);
    assert.equal(receiver.deliver("SIGUSR1"), true);
    for (const name of ["TERM", "EXIT", "ERR", "DEBUG", "RETURN", "KILL", "STOP", "INVALID"]) assert.equal(receiver.deliver(name), false, name);
    return { exitCode: 7 };
  } });
  const result = await shell.exec(`trap 'printf "signal:%s;" "$?"' USR1; deliver; printf after`);
  assert.equal(result.stdout, "signal:7;after");
  assert.equal(result.exitCode, 0);
  assert.equal(subscriptions[0]!.closed, 1);
  assert.equal(subscriptions[0]!.deliver("USR1"), false);
});

test("ignored virtual signals are acknowledged without running source", async context => {
  const { shell, subscriptions } = fixture();
  context.after(() => shell.dispose());
  shell.register({ name: "deliver", execute() {
    assert.equal(subscriptions[0]!.deliver("INT"), true);
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec(`trap '' INT; deliver; printf after`)).stdout, "after");
});

test("child subscriptions expire with the child, not the root invocation", async context => {
  const { shell, subscriptions } = fixture();
  context.after(() => shell.dispose());
  shell.register({ name: "inspect", execute() {
    assert.ok(subscriptions.length > 1);
    assert.equal(subscriptions[0]!.closed, 0);
    for (const child of subscriptions.slice(1)) {
      assert.notEqual(child.scope, subscriptions[0]!.scope);
      assert.equal(child.closed, 1);
      assert.equal(child.deliver("USR1"), false);
    }
    return { exitCode: 0 };
  } });
  const result = await shell.exec(`trap ':' USR1; (trap ':' USR1); printf x | read -r value; inspect`);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.ok(subscriptions.every(entry => entry.closed === 1));
});

for (const reason of [false, 0, "", null, new Error("cancel")]) test(`root cancellation dominates signal and EXIT handlers: ${String(reason)}`, async context => {
  const { shell, subscriptions } = fixture();
  context.after(() => shell.dispose());
  const controller = new AbortController();
  shell.register({ name: "cancel", execute() {
    subscriptions[0]!.deliver("USR1");
    controller.abort(reason);
    return { exitCode: 0 };
  } });
  let stdout = "";
  await assert.rejects(shell.exec(`trap 'printf forbidden' USR1 EXIT; cancel`, {
    signal: controller.signal, stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString(); } },
  }), error => error === reason);
  assert.equal(stdout, "");
  assert.equal(subscriptions[0]!.closed, 1);
  assert.equal(subscriptions[0]!.deliver("USR1"), false);
});

test("cancellation during EXIT does not turn into an exit status", async context => {
  const { shell, subscriptions } = fixture();
  context.after(() => shell.dispose());
  const controller = new AbortController();
  const reason = { code: "EIO", message: "root abort" };
  shell.register({ name: "cancel", execute() { controller.abort(reason); return { exitCode: 0 }; } });
  await assert.rejects(shell.exec(`trap 'cancel; exit 0' EXIT; exit 7`, { signal: controller.signal }), error => error === reason);
  assert.equal(subscriptions[0]!.closed, 1);
});

test("budgets and disposal are not successful shell termination", async context => {
  const { shell, subscriptions } = fixture();
  context.after(() => shell.dispose());
  let stdout = "";
  await assert.rejects(shell.exec(`trap 'printf forbidden' EXIT; :; :`, {
    limits: { maxCommands: 1 }, stdout: { async write(bytes) { stdout += Buffer.from(bytes).toString(); } },
  }), error => error instanceof ShellLimitError);
  assert.equal(stdout, "");
  assert.equal(subscriptions[0]!.closed, 1);
  await shell.dispose();
  assert.equal(stdout, "");
});

test("trap does not subscribe to native process-global signals", async context => {
  const before = process.eventNames().map(name => [name, process.listenerCount(name)] as const);
  const { shell } = fixture();
  context.after(() => shell.dispose());
  assert.equal((await shell.exec(`trap ':' TERM INT; :`)).exitCode, 0);
  for (const [name, count] of before) assert.equal(process.listenerCount(name), count);
  assert.deepEqual(process.eventNames(), before.map(([name]) => name));
});

test("a supplied signal catalog is a complete explicit virtual profile", async context => {
  const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [trapExtension({ signalNames: { SIGVIRTUAL: 10 } })] });
  context.after(() => shell.dispose());
  assert.equal((await shell.exec("trap ':' VIRTUAL")).exitCode, 0);
  const absent = await shell.exec("trap ':' TERM");
  assert.equal(absent.exitCode, 1);
  assert.match(absent.stderr, /TERM: invalid signal specification/);
  assert.equal((await shell.exec("trap -l")).stdout, "10) SIGVIRTUAL\t\n");
});

test("literal host invocations have independent extension scopes", async context => {
  const { shell, subscriptions } = fixture();
  context.after(() => shell.dispose());
  shell.register({ name: "delegate", async execute(command) {
    const result = await (command as ShellCommandContext).invoke("trap", ["printf forbidden", "EXIT"]);
    assert.notEqual(subscriptions[1]!.scope, subscriptions[0]!.scope);
    assert.equal(subscriptions[1]!.closed, 1);
    return result;
  } });
  const result = await shell.exec(`trap 'printf parent' EXIT; delegate; printf body`);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "bodyparent");
});
