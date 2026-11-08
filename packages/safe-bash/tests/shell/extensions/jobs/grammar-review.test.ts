import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { Shell } from "../../../../src/shell/shell.js";
import { grammarJobReference } from "./grammar53-reference.js";

function subject(context: TestContext) {
  const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()], env: { LC_ALL: "C" },
    limits: { maxWallClockMs: 1500, maxOutputBytes: 65536 },
  });
  context.after(() => shell.dispose());
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

for (const option of [
  { source: "$'-ff\\xffz'", byte: 255 },
  { source: "$'-f\\xc3\\xa9z'", byte: 195 },
  { source: "$'-ff\\xef\\xbf\\xbdz'", byte: 239 },
  { source: "-ffzf", byte: 122 },
]) test(`source-backed getopt composition emits one original byte: ${option.source}`, async context => {
  const shell = subject(context);
  const result = await shell.exec(`option=${option.source}; wait "$option"; printf '%s' "$?"`);
  assert.equal(result.stdout, "2");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.concat([
    Buffer.from("shell: line 1: wait: -"), Buffer.from([option.byte]),
    Buffer.from(": invalid option\nwait: usage: wait [-fn] [-p var] [id ...]\n"),
  ]));
});

test("source-backed zero-prefix, C-whitespace and -f composition round-trips the same child", async context => {
  const shell = subject(context);
  const result = await shell.exec("{ exit 7; } & child=$!; wait -fff -f -- \"000$child\"$' \\t\\n\\r\\v\\f'; printf 'combined:%s;' \"$?\"; wait \"$child\"; printf 'retained:%s' \"$?\"");
  assert.equal(result.stdout, "combined:7;retained:7");
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
});

for (const operand of ["+0", "$'\\t0'", "$' 0'", "$'-0'"]) {
  test(`source-backed nondigit invalid operand continues rather than gaining numeric admission: ${operand}`, async context => {
    const shell = subject(context);
    const bytes = operand === "+0" ? "+0" : operand === "$'\\t0'" ? "\t0" : operand === "$' 0'" ? " 0" : "-0";
    const result = await shell.exec(`{ exit 7; } & child=$!; wait -- ${operand} "$child"; printf '%s' "$?"`);
    assert.equal(result.stdout, "7");
    assert.equal(result.exitCode, 0);
    assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(`shell: line 1: wait: \`${bytes}': not a pid or valid job spec\n`));
  });
}

for (const operand of ["1x", "2147483648"]) {
  test(`source-backed numeric rejection does not await a following live child: ${operand}`, { timeout: 2500 }, async context => {
    const shell = subject(context);
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let closed = 0;
    shell.register({ name: "hold", async execute(invocation) {
      let disposed = false;
      const close = () => { if (!disposed) { disposed = true; closed++; release(); } };
      invocation.registerCleanup!(close);
      invocation.signal.addEventListener("abort", close, { once: true });
      try { await gate; invocation.signal.throwIfAborted(); return { exitCode: 7 }; }
      finally { invocation.signal.removeEventListener("abort", close); close(); }
    } });
    shell.register({ name: "release", execute() { release(); return { exitCode: 0 }; } });
    const execution = shell.exec(`hold & child=$!; wait ${operand} "$child"; printf 'early:%s;' "$?"; release; wait "$child"; printf 'child:%s' "$?"`, { signal: controller.signal });
    context.after(async () => { controller.abort(new Error("grammar review cleanup")); release(); await execution.catch(() => undefined); });
    const result = await execution;
    assert.equal(result.stdout, "early:1;child:7");
    assert.equal(result.exitCode, 0);
    assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(`shell: line 1: wait: \`${operand}': not a pid or valid job spec\n`));
    assert.equal(closed, 1);
  });
}

for (const reason of [false, 0, "", null]) {
  test(`grammar option admission preserves already-aborted reason ${String(reason)}`, async context => {
    const shell = subject(context);
    const controller = new AbortController();
    controller.abort(reason);
    await assert.rejects(shell.exec("wait -fff -- 0", { signal: controller.signal }), failure => Object.is(failure, reason));
  });
}

test("immutable native grammar references retain isolated returned byte ownership", () => {
  const native = grammarJobReference(8);
  const previous = Buffer.from(native.stderr);
  native.stderr.fill(0);
  assert.deepEqual(grammarJobReference(8).stderr, previous);
  assert.ok(previous.includes(Buffer.from([45, 255, 58])));
  assert.ok(previous.includes(Buffer.from([45, 195, 58])));
});
