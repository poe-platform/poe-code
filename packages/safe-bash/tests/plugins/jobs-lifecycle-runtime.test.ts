import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";
import { primaryJobReference } from "../shell/extensions/jobs/primary53-reference.js";

type Extension = NonNullable<import("poe-code/safe-bash").ShellOptions["extensions"]>[number];
type CommandContext = import("poe-code/safe-bash").CommandContext;
type Optional = { jobsExtension(): Extension; trapExtension(): Extension };

const selected = process.env.SAFE_BASH_TEST_OPTIONAL_BUILD;
if (selected !== undefined && selected !== "1") throw new Error("SAFE_BASH_TEST_OPTIONAL_BUILD must be 1 when supplied");

function adapt(source: string, original: string, replacement: string) {
  assert.equal(source.split(original).length, 2, "Native adaptation must replace exactly one recorded fragment");
  return source.replace(original, replacement);
}

function gates(keys: readonly string[], marker: string | undefined) {
  const entries = new Map(keys.map(key => [key, { released: false, acquired: false, waiters: new Set<() => void>() }]));
  let stopped = false;
  let active = 0;
  let acquired = 0;
  let released = 0;
  let markers = 0;
  let total = 0;
  let pending = Buffer.alloc(0);
  const wake = () => {
    for (const entry of entries.values()) {
      entry.released = true;
      for (const resolve of entry.waiters) resolve();
    }
  };
  return {
    get counts() { return { active, acquired, released, markers }; },
    close() { stopped = true; wake(); },
    stdout: { async write(bytes: Uint8Array) {
      total += bytes.byteLength;
      assert.ok(total <= 65536, "Lifecycle controller output limit exceeded");
      pending = Buffer.concat([pending, Buffer.from(bytes)]);
      let end: number;
      while ((end = pending.indexOf(10)) !== -1) {
        const line = pending.subarray(0, end).toString();
        pending = pending.subarray(end + 1);
        if (line === marker) { markers++; assert.equal(markers, 1); wake(); }
      }
    } },
    async execute(context: CommandContext) {
      assert.equal(context.args.length, 1);
      const entry = entries.get(context.args[0]!);
      assert.ok(entry, "Unexpected lifecycle gate");
      let closed = false;
      let admitted = false;
      let resolve: (() => void) | undefined;
      let abort: (() => void) | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (timer !== undefined) clearTimeout(timer);
        if (abort) context.signal.removeEventListener("abort", abort);
        if (resolve) { entry.waiters.delete(resolve); resolve(); }
        if (admitted) { active--; released++; }
      };
      assert.equal(typeof context.registerCleanup, "function");
      context.registerCleanup!(cleanup);
      try {
        context.signal.throwIfAborted();
        assert.ok(!closed && !stopped, "Gate admission is closed");
        assert.equal(entry.acquired, false, "Gate may be acquired only once");
        entry.acquired = true;
        admitted = true;
        active++; acquired++;
        if (!entry.released) await new Promise<void>((accept, reject) => {
          resolve = accept;
          entry.waiters.add(accept);
          abort = () => reject(context.signal.reason);
          context.signal.addEventListener("abort", abort, { once: true });
          timer = setTimeout(() => reject(new Error("Lifecycle gate was not released within 750ms")), 750);
          if (context.signal.aborted) abort();
        });
        context.signal.throwIfAborted();
        assert.ok(!closed && !stopped, "Gate closed before completion");
        return { exitCode: 0 };
      } finally { cleanup(); }
    },
  };
}

async function setup(context: TestContext, keys: readonly string[] = [], marker?: string, withTrap = false) {
  const published = await import("poe-code/safe-bash");
  const { createMemoryFileSystem } = await import("poe-code/safe-fs");
  const optional = await import(new URL("../../dist/optional.js", import.meta.url).href) as Optional;
  const extensions = [optional.jobsExtension(), ...(withTrap ? [optional.trapExtension()] : [])];
  const fs = createMemoryFileSystem();
  const shell = new published.Shell({ fs, extensions, limits: { maxWallClockMs: 2000, maxOutputBytes: 65536 } }).use(published.agentCommands());
  const controller = gates(keys, marker);
  context.after(async () => {
    controller.close();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        shell.dispose(),
        new Promise<never>((resolve, reject) => { timer = setTimeout(() => reject(new Error("Lifecycle shell disposal exceeded 1500ms")), 1500); }),
      ]);
      assert.equal(controller.counts.active, 0);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  });
  const identities: string[][] = [];
  const snapshots: { args: readonly string[]; visible: string | undefined; cwd: string }[] = [];
  shell.register({ name: "review_gate", runtimeIdentity: published.commandRuntimeIdentity, execute: controller.execute });
  shell.register({ name: "review_identity", runtimeIdentity: published.commandRuntimeIdentity, async execute(command) {
    assert.equal(identities.length, 0);
    assert.ok(command.args.length > 0 && command.args.length <= 2);
    for (const token of command.args) assert.ok(Number.isSafeInteger(Number(token)) && Number(token) > 0 && String(Number(token)) === token);
    identities.push([...command.args]);
    return { exitCode: 0 };
  } });
  shell.register({ name: "review_snapshot", runtimeIdentity: published.commandRuntimeIdentity, async execute(command) {
    assert.ok(snapshots.length < 2);
    assert.equal(command.args.length, 2);
    snapshots.push({ args: [...command.args], visible: command.env.visible, cwd: command.cwd });
    return { exitCode: 0 };
  } });
  return { shell, fs, controller, identities, snapshots };
}

function childDiagnostic(native: Buffer, virtual: string) {
  const prefix = "shell: line 1: wait: pid ";
  const suffix = " is not a child of this shell\n";
  const text = native.toString();
  assert.ok(text.startsWith(prefix) && text.endsWith(suffix));
  const token = text.slice(prefix.length, -suffix.length);
  assert.ok(token.length > 0 && [...token].every(character => character >= "0" && character <= "9"));
  return Buffer.from(`${prefix}${virtual}${suffix}`);
}

describe("compiled jobs lifecycle adaptations", { skip: selected === undefined ? "Requires current public/optional builds and SAFE_BASH_TEST_OPTIONAL_BUILD=1" : false }, () => {
  test("adapted primary 6: bare wait forgets status but retains last child identity", { timeout: 5000 }, async context => {
    const expected = primaryJobReference(6);
    assert.equal(expected.requiresController, true);
    const subject = await setup(context);
    const source = adapt(expected.source, `printf 'CHILD:%s\\n' "$child" >&9`, 'review_identity "$child"');
    const result = await subject.shell.exec(source, { env: { LC_ALL: "C" } });
    assert.equal(subject.identities.length, 1);
    assert.equal(result.exitCode, expected.status);
    assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), childDiagnostic(expected.stderr, subject.identities[0]![0]!));
    assert.deepEqual(subject.controller.counts, { active: 0, acquired: 0, released: 0, markers: 0 });
  });

  test("adapted primary 11: live virtual identities remain distinct and survive foreground work and waits", { timeout: 5000 }, async context => {
    const expected = primaryJobReference(11);
    assert.equal(expected.requiresController, true);
    const subject = await setup(context, ["3", "4"], "RELEASE");
    let source = adapt(expected.source, "IFS= read -r gate <&3", "review_gate 3");
    source = adapt(source, "IFS= read -r gate <&4", "review_gate 4");
    source = adapt(source, "second=$!;", 'second=$!; review_identity "$first" "$second";');
    const result = await subject.shell.exec(source, { env: { LC_ALL: "C" }, stdout: subject.controller.stdout });
    assert.equal(subject.identities.length, 1);
    assert.notEqual(subject.identities[0]![0], subject.identities[0]![1]);
    assert.equal(result.exitCode, expected.status);
    assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), expected.stderr);
    assert.deepEqual(subject.controller.counts, { active: 0, acquired: 2, released: 2, markers: 1 });
  });

  test("adapted primary 12: parent and child retain separate variables exports functions cwd and positionals", { timeout: 5000 }, async context => {
    const expected = primaryJobReference(12);
    assert.equal(expected.requiresController, true);
    const subject = await setup(context, ["3"], "RELEASE");
    await subject.fs.mkdir("/origin");
    await subject.fs.mkdir("/private");
    let source = adapt(expected.source, "IFS= read -r gate <&3", "review_gate 3");
    source = adapt(source, "snapshot; cd / || exit 90;", 'review_snapshot "$value" "$1"; snapshot; cd / || exit 90;');
    source = adapt(source, "snapshot; [[ $PWD == /private ]]", 'review_snapshot "$value" "$1"; snapshot; [[ $PWD == /private ]]');
    const result = await subject.shell.exec(source, { cwd: "/origin", env: { LC_ALL: "C" }, stdout: subject.controller.stdout });
    assert.equal(result.exitCode, expected.status);
    assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), expected.stderr);
    assert.deepEqual(subject.snapshots, [
      { args: ["old", "before"], visible: "before", cwd: "/origin" },
      { args: ["new", "after"], visible: "after", cwd: "/private" },
    ]);
    assert.deepEqual(subject.controller.counts, { active: 0, acquired: 1, released: 1, markers: 1 });
  });

  test("adapted primary 13: subshell inherits last child token without acquiring parent wait ownership", { timeout: 5000 }, async context => {
    const expected = primaryJobReference(13);
    assert.equal(expected.requiresController, true);
    const subject = await setup(context, ["3"], "RELEASE");
    let source = adapt(expected.source, "IFS= read -r gate <&3", "review_gate 3");
    source = adapt(source, `printf 'CHILD:%s\\n' "$child" >&9`, 'review_identity "$child"');
    const result = await subject.shell.exec(source, { env: { LC_ALL: "C" }, stdout: subject.controller.stdout });
    assert.equal(subject.identities.length, 1);
    assert.equal(result.exitCode, expected.status);
    assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), childDiagnostic(expected.stderr, subject.identities[0]![0]!));
    assert.deepEqual(subject.controller.counts, { active: 0, acquired: 1, released: 1, markers: 1 });
  });

  for (const id of [17, 18]) test(`adapted primary ${id}: ${id === 17 ? "EXIT marker precedes natural child draining" : "explicit wait completes child before EXIT"}`, { timeout: 5000 }, async context => {
    const expected = primaryJobReference(id);
    assert.equal(expected.requiresController, true);
    const subject = await setup(context, ["3"], id === 17 ? "EXIT:3" : "RELEASE", true);
    const source = adapt(expected.source, "IFS= read -r gate <&3", "review_gate 3; gate=go");
    const result = await subject.shell.exec(source, { env: { LC_ALL: "C" }, stdout: subject.controller.stdout });
    assert.equal(result.exitCode, expected.status);
    assert.deepEqual(Buffer.from(result.stdoutBytes), expected.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), expected.stderr);
    assert.deepEqual(subject.controller.counts, { active: 0, acquired: 1, released: 1, markers: 1 });
  });
});
