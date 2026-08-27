import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { Runtime } from "../../../../src/shell/runtime.js";
import type { State } from "../../../../src/shell/runtime.js";
import { runtimeSetup } from "./helpers.js";

async function observe(action: (states: State[]) => Promise<void>): Promise<void> {
  const original = Runtime.prototype.builtin;
  const states: State[] = [];
  Runtime.prototype.builtin = async function (...args) {
    if (args[0].command === "getopts") states.push(args[1]);
    return original.apply(this, args);
  };
  try { await action(states); }
  finally { Runtime.prototype.builtin = original; }
}

test("D01 readonly OPTIND stops before OPTARG/name but retains hidden progress", async () => observe(async states => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('OPTARG=old; opt=old; readonly OPTIND; getopts ab opt -ab; say "$?:$OPTIND:$OPTARG:$opt"; getopts ab opt -ab; say "$?:$OPTIND:$OPTARG:$opt"');
  assert.equal(result.stdout, "1:1:old:old\n1:1:old:old\n");
  assert.deepEqual(states[0]!.getopts?.cursor, { index: 2 });
  assert.equal(result.stderr.match(/OPTIND: readonly variable/gu)?.length, 2);
}));

test("D01/N13 readonly OPTARG retains value and attribute for set, no-arg and EOF", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('opt=old; readonly OPTARG=old; getopts a:b opt -a value -b; say "$?:$OPTIND:$OPTARG:$opt"; getopts a:b opt -a value -b; say "$?:$OPTIND:$OPTARG:$opt"; getopts a:b opt -a value -b; say "$?:$OPTIND:$OPTARG:$opt"; unset OPTARG; say "$?:$OPTARG"');
  assert.equal(result.stdout, "1:3:old:old\n1:4:old:old\n1:4:old:old\n1:old\n");
  assert.equal(result.stderr.match(/OPTARG: (?:cannot unset: )?readonly variable/gu)?.length, 4);
});

test("late name validation preserves OPTIND/OPTARG and does not execute name syntax", async () => {
  const { shell, fs } = runtimeSetup();
  const result = await shell.exec('OPTARG=old; getopts a: "bad[1]" -a value; say "$?:$OPTIND:$OPTARG"; OPTIND=1; getopts a __proto__ -a; say "$__proto__"; OPTIND=1; getopts a "$(say bad-name)" -a; say "$?:$OPTIND"');
  assert.equal(result.stdout, "1:3:value\na\n1:2\n");
  assert.match(result.stderr, /bad\[1\].*not a valid identifier/u);
  assert.deepEqual(await fs.readdir("/"), []);
});

test("readonly result name fails after checked index/argument, including EOF", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec('readonly opt=old; OPTARG=old; getopts ab opt -ab; say "$?:$OPTIND:${OPTARG+x}:$opt"; getopts ab opt -ab; say "$?:$OPTIND:${OPTARG+x}:$opt"; getopts ab opt -ab; say "$?:$OPTIND:${OPTARG+x}:$opt"');
  assert.equal(result.stdout, "1:1::old\n1:2::old\n1:2::old\n");
});

for (const setter of ['export OPTIND=1', 'read OPTIND <<< 1', 'OPTIND=1 :', 'f() { local OPTIND=1; }; f']) {
  test(`D01 failed setter does not reset cursor: ${setter}`, async () => observe(async states => {
    const { shell } = runtimeSetup();
    await shell.exec(`getopts abc opt -abc; readonly OPTIND; ${setter}; getopts abc opt -abc`);
    assert.deepEqual(states[0]!.getopts?.cursor, { index: 1, active: { argument: 0, offset: 3 } });
  }));
}

for (const reason of [new Error("sink refusal"), false, 0, "", null, undefined]) {
  test(`parser sink rejection preserves only hidden state, existing mapping ${String(reason)}`, async () => {
    const { shell } = runtimeSetup();
    const writes: string[] = [];
    const result = await shell.exec('OPTARG=old; opt=old; getopts a opt -za; say "$?:$OPTIND:$OPTARG:$opt"; getopts a opt -za; say "$opt:$OPTIND"', { stderr: { async write(chunk) {
      const text = new TextDecoder().decode(chunk);
      writes.push(text);
      if (writes.length === 1) throw reason;
    } } });
    assert.equal(result.stdout, "1:1:old:old\na:2\n");
    assert.equal(writes[0], "shell: illegal option -- z\n");
    assert.equal(writes.length, 2);
    assert.equal(result.exitCode, 0);
  });
}

test("EPIPE diagnostic failure uses existing141 mapping, not usage2", async () => {
  const { shell } = runtimeSetup();
  const result = await shell.exec("getopts a opt -z", { stderr: { async write() { throw Object.assign(new Error("closed"), { code: "EPIPE" }); } } });
  assert.equal(result.exitCode, 141);
});

for (const reason of [false, 0, "", null, undefined]) {
  test(`caller abort during parser diagnostic keeps reason identity and prevents late stores: ${String(reason)}`, { timeout: 2000 }, async () => observe(async states => {
    const { shell } = runtimeSetup();
    const controller = new AbortController();
    let complete!: () => void;
    const pending = new Promise<void>(resolve => { complete = resolve; });
    const execution = shell.exec('OPTARG=old; opt=old; getopts a opt -za', { signal: controller.signal, stderr: { write() { controller.abort(reason); return pending; } } });
    await assert.rejects(execution, error => error === controller.signal.reason);
    complete();
    await setImmediate();
    assert.equal(states[0]!.variables.OPTIND, "1");
    assert.equal(states[0]!.variables.OPTARG, "old");
    assert.equal(states[0]!.variables.opt, "old");
    assert.deepEqual(states[0]!.getopts?.cursor, { index: 1, active: { argument: 0, offset: 2 } });
    await shell.dispose();
  }));
}

test("D01 prefix restoration restores exact binding and hidden state on abort", async () => observe(async states => {
  const { shell } = runtimeSetup();
  const controller = new AbortController();
  const reason = new Error("prefix cancelled");
  await assert.rejects(shell.exec('getopts abc opt -abc; getopts abc opt -abc; OPTIND=1 getopts a opt -z', { signal: controller.signal, stderr: { async write() { controller.abort(reason); } } }), error => error === reason);
  await setImmediate();
  assert.equal(states[0]!.variables.OPTIND, "1");
  assert.deepEqual(states[0]!.getopts?.cursor, { index: 1, active: { argument: 0, offset: 3 } });
}));

test("silent mode and OPTERR suppression perform zero parser writes", async () => {
  const { shell } = runtimeSetup();
  for (const source of ['getopts :a opt -z', 'getopts :a: opt -a', 'OPTERR=0; getopts a opt -z']) {
    let writes = 0;
    const result = await shell.exec(source, { stdout: { async write() { throw new Error("unexpected stdout"); } }, stderr: { async write() { writes++; throw new Error("unexpected stderr, including empty writes"); } } });
    assert.equal(result.exitCode, 0);
    assert.equal(writes, 0);
    assert.equal(result.stdoutBytes.length, 0);
    assert.equal(result.stderrBytes.length, 0);
  }
});
