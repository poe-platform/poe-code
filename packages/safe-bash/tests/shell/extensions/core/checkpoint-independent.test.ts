import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtension, ShellExtensionInstance } from "../../../../src/shell/extensions.js";
import { arraysExtension } from "../../../../src/shell/extensions/arrays/index.js";
import { Shell } from "../../../../src/shell/shell.js";

async function bounded<Value>(pending: Promise<Value>, operation: string): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${operation} did not settle within 500ms`)), 500);
    })]);
  } finally { clearTimeout(timer); }
}

function setup(context: TestContext, extensions: readonly ShellExtension[]) {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs, extensions });
  context.after(() => bounded(shell.dispose(), "shell disposal"));
  for (const command of basicCommands()) shell.register(command);
  return { shell, fs };
}

for (const forked of [false, true]) test(`checkpoint captures the callable without consulting its bind property: fork=${forked}`, async context => {
  const observed: string[] = [];
  let bindReads = 0;
  function instance(label: string): ShellExtensionInstance {
    const owner: ShellExtensionInstance = { builtins: [], fork: scope => instance(scope) };
    function checkpoint(this: ShellExtensionInstance) {
      assert.equal(this, owner);
      observed.push(label);
    }
    if (forked ? label !== "parent" : label === "parent") {
      Object.defineProperty(checkpoint, "bind", { get() {
        bindReads++;
        throw new Error("callback bind property must not be read");
      } });
    }
    Object.defineProperty(owner, "checkpoint", { value: checkpoint });
    return owner;
  }
  const { shell } = setup(context, [{ name: "checkpoint-capture-independent", create: () => instance("parent") }]);
  const result = await shell.exec(forked ? "(for item in a; do :; done); for item in a; do :; done" : "for item in a; do :; done");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(bindReads, 0);
  assert.deepEqual(observed, forked ? ["parent", "subshell", "parent"] : ["parent"]);
});

for (const event of ["function-leave", "source-leave"] as const) {
  for (const reason of [false, 0, null]) test(`checkpoint failure in ${event} keeps original reason ${JSON.stringify(reason)}`, async context => {
    let callbacks = 0;
    let cleanups = 0;
    let continued = false;
    const { shell, fs } = setup(context, [{ name: "checkpoint-cleanup-independent", create: () => ({
      builtins: [{ name: "continued", execute() { continued = true; return 0; } }],
      async event(point, command) {
        if (point === event) await command.evaluate("for nested in a; do :; done");
      },
      checkpoint(_point, command) {
        callbacks++;
        command.registerCleanup(() => { cleanups++; });
        throw reason;
      },
    }) }]);
    if (event === "source-leave") await fs.writeFile("/body.sh", new TextEncoder().encode(":"));
    const source = event === "function-leave" ? "f() { :; }; f; continued" : "source /body.sh; continued";
    const pending = shell.exec(source).then(value => ({ rejected: false, reason: value as unknown }), failure => ({ rejected: true, reason: failure as unknown }));
    const outcome = await (event === "source-leave" ? bounded(pending, "source-leave checkpoint rejection") : pending);
    assert.equal(outcome.rejected, true);
    assert.equal(outcome.reason, reason);
    assert.equal(callbacks, 1);
    assert.equal(cleanups, 1);
    assert.equal(continued, false);
  });
}

for (const event of ["function-leave", "source-leave"] as const) test(`normal checkpoint in ${event} closes and continues`, async context => {
  let callbacks = 0;
  let cleanups = 0;
  let continued = false;
  const { shell, fs } = setup(context, [{ name: "checkpoint-leave-control", create: () => ({
    builtins: [{ name: "continued", execute() { continued = true; return 0; } }],
    async event(point, command) {
      if (point === event) await command.evaluate("for nested in a; do :; done");
    },
    checkpoint(_point, command) {
      callbacks++;
      command.registerCleanup(() => { cleanups++; });
    },
  }) }]);
  if (event === "source-leave") await fs.writeFile("/body.sh", new TextEncoder().encode(":"));
  const result = await shell.exec(event === "function-leave" ? "f() { :; }; f; continued" : "source /body.sh; continued");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(callbacks, 1);
  assert.equal(cleanups, 1);
  assert.equal(continued, true);
});

test("baseline source-leave rejection without checkpoint retains its reason", async context => {
  const { shell, fs } = setup(context, [{ name: "source-leave-baseline", create: () => ({
    builtins: [],
    event(point) { if (point === "source-leave") throw false; },
  }) }]);
  await fs.writeFile("/body.sh", new TextEncoder().encode(":"));
  const outcome = await bounded(shell.exec("source /body.sh").then(value => ({ rejected: false, reason: value as unknown }), reason => ({ rejected: true, reason: reason as unknown })), "source-leave baseline rejection");
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, false);
});

test("checkpoint ignores action-shaped payload accessors without reading them", async context => {
  let actionReads = 0;
  let callbacks = 0;
  const payload = Object.defineProperty({}, "action", { get() { actionReads++; throw new Error("action must not be read"); } });
  const { shell } = setup(context, [{ name: "checkpoint-payload-independent", create: () => ({
    builtins: [],
    async checkpoint() { callbacks++; await Promise.resolve(); return payload as never; },
  }) }]);
  const result = await shell.exec("for item in a b; do :; done; printf after");
  assert.equal(result.stdout, "after");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.equal(callbacks, 2);
  assert.equal(actionReads, 0);
});

test("checkpoint completion microtask cancellation prevents the next observer", async context => {
  const controller = new AbortController();
  let cleanups = 0;
  let later = 0;
  let continued = false;
  const { shell } = setup(context, [
    { name: "checkpoint-first-independent", create: () => ({
      builtins: [],
      checkpoint(_point, command) {
        command.registerCleanup(() => { cleanups++; });
        queueMicrotask(() => controller.abort(0));
      },
    }) },
    { name: "checkpoint-second-independent", create: () => ({
      builtins: [{ name: "continued", execute() { continued = true; return 0; } }],
      checkpoint() { later++; },
    }) },
  ]);
  const outcome = await shell.exec("for item in a; do :; done; continued", { signal: controller.signal }).then(value => ({ rejected: false, reason: value as unknown }), reason => ({ rejected: true, reason: reason as unknown }));
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, 0);
  assert.equal(cleanups, 1);
  assert.equal(later, 0);
  assert.equal(continued, false);
});

for (const pipefail of [false, true]) test(`checkpoint observers preserve pipeline and raw result state: pipefail=${pipefail}`, async context => {
  const observations: unknown[] = [];
  const points: string[] = [];
  function observer(name: string): ShellExtension {
    return { name, create: () => ({ builtins: [], checkpoint(point, command) {
      points.push(`${name}:${point}`);
      if (point !== "loop-body-complete") return;
      observations.push({ status: command.status, first: command.bindings.get("PIPESTATUS", 0), second: command.bindings.get("PIPESTATUS", 1), command: command.variable("BASH_COMMAND") });
    } }) };
  }
  const baseline = setup(context, [arraysExtension()]);
  const observed = setup(context, [arraysExtension(), observer("checkpoint-one"), observer("checkpoint-two")]);
  const source = `${pipefail ? "set -o pipefail; " : ""}for item in a; do false | true; done; printf '%s|%s|%s|%s' "$?" "\${PIPESTATUS[0]}" "\${PIPESTATUS[1]}" "$BASH_COMMAND"`;
  const expected = await baseline.shell.exec(source);
  const actual = await observed.shell.exec(source);
  assert.equal(actual.exitCode, expected.exitCode);
  assert.deepEqual(actual.stdoutBytes, expected.stdoutBytes);
  assert.deepEqual(actual.stderrBytes, expected.stderrBytes);
  assert.deepEqual(points, ["checkpoint-one:child-job-install", "checkpoint-two:child-job-install", "checkpoint-one:loop-body-complete", "checkpoint-two:loop-body-complete"]);
  assert.equal(observations.length, 2);
  assert.deepEqual(observations[0], observations[1]);
  assert.deepEqual(observations[0], { status: pipefail ? 1 : 0, first: "1", second: "0", command: "true" });
});

for (const body of [":", "return 7", "exit 9"]) test(`source-leave checkpoint failure outranks secondary cleanup after ${body}`, async context => {
  let cleanups = 0;
  let continued = false;
  const { shell, fs } = setup(context, [{ name: "source-leave-secondary", create: () => ({
    builtins: [{ name: "continued", execute() { continued = true; return 0; } }],
    async event(point, command) {
      if (point === "source-leave") await command.evaluate("for nested in a; do :; done");
    },
    checkpoint(_point, command) {
      command.registerCleanup(() => { cleanups++; throw new Error("secondary cleanup"); });
      throw false;
    },
  }) }]);
  await fs.writeFile("/body.sh", new TextEncoder().encode(body));
  const outcome = await bounded(shell.exec("source /body.sh argument; continued").then(value => ({ rejected: false, reason: value as unknown }), reason => ({ rejected: true, reason: reason as unknown })), "source-leave secondary failure");
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, false);
  assert.equal(cleanups, 1);
  assert.equal(continued, false);
});

for (const primary of [false, 0]) test(`source body checkpoint retains primary ${String(primary)} over leave and cleanup failures`, async context => {
  let callbacks = 0;
  let cleanups = 0;
  const { shell, fs } = setup(context, [{ name: "source-primary-independent", create: () => ({
    builtins: [],
    async event(point, command) {
      if (point === "source-leave") await command.evaluate("for nested in a; do :; done");
    },
    checkpoint(_point, command) {
      callbacks++;
      command.registerCleanup(() => { cleanups++; throw new Error("secondary cleanup"); });
      throw callbacks === 1 ? primary : new Error("secondary source-leave");
    },
  }) }]);
  await fs.writeFile("/body.sh", new TextEncoder().encode("for item in a; do :; done"));
  const outcome = await bounded(shell.exec("source /body.sh argument").then(value => ({ rejected: false, reason: value as unknown }), reason => ({ rejected: true, reason: reason as unknown })), "source primary checkpoint failure");
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, primary);
  assert.equal(callbacks, 2);
  assert.equal(cleanups, 2);
});

test("source-leave cancellation drains admitted checkpoint work and preserves zero", async context => {
  const controller = new AbortController();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const admission = new Promise<void>(resolve => { entered = resolve; });
  context.after(() => { release(); });
  let acquired = false;
  let closed = false;
  const { shell, fs } = setup(context, [{ name: "source-cancel-independent", create: () => ({
    builtins: [],
    async event(point, command) {
      if (point === "source-leave") await command.evaluate("for nested in a; do :; done");
    },
    async checkpoint(_point, command) {
      command.registerCleanup(async () => { await gate; closed = acquired; throw new Error("secondary cleanup"); });
      entered();
      await gate;
      acquired = true;
      throw false;
    },
  }) }]);
  await fs.writeFile("/body.sh", new TextEncoder().encode(":"));
  const running = shell.exec("source /body.sh argument", { signal: controller.signal }).then(value => ({ rejected: false, reason: value as unknown }), reason => ({ rejected: true, reason: reason as unknown }));
  await bounded(Promise.race([admission, running.then(() => { throw new Error("checkpoint not admitted"); })]), "source checkpoint admission");
  controller.abort(0);
  let settled = false;
  void running.then(() => { settled = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  const outcome = await bounded(running, "cancelled source checkpoint drain");
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, 0);
  assert.equal(closed, true);
});

test("handled source-leave failure restores parent positionals and frame depths", async context => {
  let caught = false;
  const observations: unknown[] = [];
  const { shell, fs } = setup(context, [{ name: "source-restoration-independent", create: () => ({
    builtins: [{ name: "recover", async execute(command) {
      try { await command.evaluate("source /body.sh inner"); }
      catch { caught = true; }
      return 0;
    } }, { name: "report", execute(command) {
      observations.push({ args: command.args, sourceDepth: command.sourceDepth, functionDepth: command.functionDepth });
      return 0;
    } }],
    event(point) { if (point === "source-leave") throw false; },
  }) }]);
  await fs.writeFile("/body.sh", new TextEncoder().encode(":"));
  const result = await bounded(shell.exec('set -- outer; recover; report "$1" "$#"'), "handled source-leave restoration");
  assert.equal(caught, true);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(observations, [{ args: ["outer", "1"], sourceDepth: 0, functionDepth: 0 }]);
});

for (const primary of [false, 0]) test(`source-enter host primary ${String(primary)} survives source-leave cleanup failure`, async context => {
  let leaves = 0;
  let cleanups = 0;
  const { shell, fs } = setup(context, [{ name: "source-host-primary-independent", create: () => ({
    builtins: [],
    event(point, command) {
      if (point === "source-enter") {
        command.registerCleanup(() => { cleanups++; throw new Error("secondary owned cleanup"); });
        throw primary;
      }
      if (point === "source-leave") { leaves++; throw new Error("secondary leave failure"); }
    },
  }) }]);
  await fs.writeFile("/body.sh", new TextEncoder().encode(":"));
  const outcome = await bounded(shell.exec("source /body.sh inner").then(value => ({ rejected: false, reason: value as unknown }), reason => ({ rejected: true, reason: reason as unknown })), "source host primary failure");
  assert.equal(outcome.rejected, true);
  assert.equal(outcome.reason, primary);
  assert.equal(leaves, 1);
  assert.equal(cleanups, 1);
});

for (const point of ["source-enter", "source-leave"] as const) {
  for (const reason of [undefined, null, false, 0, "", { host: "source failure" }]) {
    test(`nested ${point} preserves host failure identity ${String(reason)}`, async context => {
      let cleanups = 0;
      let leaves = 0;
      const { shell, fs } = setup(context, [{ name: "nested-source-host-independent", create: () => ({
        builtins: [],
        event(event, command) {
          if (event === "source-leave") leaves++;
          if (event === point) {
            command.registerCleanup(() => { cleanups++; });
            throw reason;
          }
        },
      }) }]);
      await fs.writeFile("/body.sh", new TextEncoder().encode(":"));
      const outcome = await bounded(shell.exec("f() { source /body.sh; }; f").then(
        value => ({ rejected: false, reason: value as unknown }),
        error => ({ rejected: true, reason: error as unknown }),
      ), "nested source host failure");
      assert.equal(cleanups, 1);
      assert.equal(leaves, 1);
      assert.equal(outcome.rejected, true);
      assert.equal(outcome.reason, reason);
    });
  }
}
