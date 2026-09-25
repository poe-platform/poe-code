import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "poe-code/safe-fs";
import { Shell } from "../../../../src/shell/shell.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { mapfileExtension } from "../../../../src/shell/extensions/mapfile/index.js";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createJobState } from "../../../../src/shell/extensions/jobs/state.js";

test("mapfile extension replaces core builtins by default", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [mapfileExtension()] });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const result = await shell.exec("mapfile -t values <<<'hello'; printf '%s' \"${values[0]}\"");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello");
});

for (const spec of ["%1", "%%", "%+", "%-"]) {
  test(`wait accepts ${spec}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] });
    context.after(() => shell.dispose());
    const result = await shell.exec(`{ exit 7; } & { exit 9; } & wait ${spec}`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, spec === "%1" || spec === "%-" ? 7 : 9);
  });
}

for (const target of ["%1", "$!"]) {
test(`jobs lists virtual children and kill terminates ${target}`, async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  shell.register({ name: "hold", async execute(invocation) {
    invocation.signal.addEventListener("abort", release, { once: true });
    try { await held; invocation.signal.throwIfAborted(); }
    finally { invocation.signal.removeEventListener("abort", release); }
    return { exitCode: 0 };
  } });
  shell.register({ name: "release", execute() { release(); return { exitCode: 0 }; } });
  context.after(release);
  const result = await shell.exec(`hold & jobs -p; printf '%s\\n' "$!"; kill ${target}; release; wait %1`);
  assert.equal(result.stderr, "");
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], lines[1]);
  assert.equal(result.exitCode, 143);
});
}

test("jobs and kill signal listing are available without operands", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] });
  context.after(() => shell.dispose());
  const result = await shell.exec("{ exit 0; } & jobs; kill -l; wait");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout.includes("[1]+"));
  assert.ok(result.stdout.includes("TERM"));
});

test("kill lists signals and rejects foreign PIDs", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] });
  context.after(() => shell.dispose());
  const result = await shell.exec("kill -l 15; kill 2147483647");
  assert.equal(result.stdout, "TERM\n");
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes("no such process"));
});

test("wait -n accepts job specs and publishes the virtual PID", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] });
  for (const command of basicCommands()) shell.register(command);
  context.after(() => shell.dispose());
  const result = await shell.exec("{ exit 7; } & wait -n -p child %1; printf '%s:%s' \"$child\" \"$!\"");
  assert.equal(result.stderr, "");
  const [selected, latest] = result.stdout.split(":");
  assert.ok(selected);
  assert.equal(selected, latest);
});

test("unknown job specs return 127", async context => {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] });
  context.after(() => shell.dispose());
  const result = await shell.exec("wait %99");
  assert.equal(result.exitCode, 127);
  assert.ok(result.stderr.includes("no such job"));
});

for (const cleanupFailure of [false, true]) {
  test(`job termination joins cleanup and preserves its failure: ${cleanupFailure}`, async () => {
    const jobs = createJobState();
    let release!: () => void;
    const cleanup = new Promise<void>(resolve => { release = resolve; });
    const failure = new Error("cleanup failed");
    const handle = await jobs.start(async task => {
      task.registerCleanup(async () => { await cleanup; if (cleanupFailure) throw failure; });
      return { async run() {
        await new Promise<void>(resolve => {
          if (task.signal.aborted) resolve();
          else task.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        task.signal.throwIfAborted();
        return 0;
      } };
    });
    try {
      assert.equal(jobs.signal(handle, 0), true);
      assert.equal(jobs.signal(handle, 15), true);
      assert.notEqual(jobs.snapshot()[0]?.state, "done");
      release();
      const outcome = await handle.completion;
      assert.deepEqual(outcome, cleanupFailure ? { kind: "failure", reason: failure } : { kind: "status", status: 143 });
      if (cleanupFailure) await assert.rejects(jobs.finish(), error => error === failure);
      else await jobs.finish();
    } finally { release(); await jobs.close().catch(() => undefined); }
  });
}
