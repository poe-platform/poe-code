import assert from "node:assert/strict";
import { test } from "node:test";
import { ShellLimitError } from "../../src/shell/index.js";
import { setup } from "./helpers.js";

for (const invocation of ["bash /job", "sh /job", "/job"]) test(`background review: script entry ${invocation}`, async () => {
  const { shell, fs } = setup();
  try {
    await fs.writeFile("/job", new TextEncoder().encode('#!/bin/bash\nstatus 7 & p=$!; wait "$p"; say $?\n'), { mode: 0o755 });
    const result = await shell.exec(invocation);
    assert.equal(result.stdout, "7\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  } finally { await shell.dispose(); }
});

for (const redirect of ["<&0", "0<&0"]) test(`background review: explicit ${redirect} preserves caller input`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(`{ read x; args "$x"; } ${redirect} & wait`, { stdin: "input\n" });
    assert.equal(result.stdout, '["input"]');
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("background review: borrowed input descriptor survives function return", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "later", async execute() { await new Promise<void>(resolve => setImmediate(resolve)); return { exitCode: 0 }; } });
  try {
    const result = await shell.exec('f() { { later; read x <&3; args "$x"; } & }; f 3<&0; wait', { stdin: "input\n" });
    assert.equal(result.stdout, '["input"]');
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("background review: function local indexed snapshot outlives its function", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "later", async execute() { await new Promise<void>(resolve => setImmediate(resolve)); return { exitCode: 0 }; } });
  try {
    const result = await shell.exec('f() { local -a x; x=(a b); { later; args "${x[@]}"; } & }; f; wait');
    assert.equal(result.stdout, '["a","b"]');
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("background review: explicitly inherited nonstandard output descriptor stays open", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "later", async execute() { await new Promise<void>(resolve => setImmediate(resolve)); return { exitCode: 0 }; } });
  try {
    const result = await shell.exec('{ { later; say child >&3; } & } 3>/out; wait; pass </out');
    assert.equal(result.stdout, "child\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("background review: function-owned redirected output outlives the launching function", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "delayed", async execute({ stdout }) {
    await new Promise<void>(resolve => setImmediate(resolve));
    await stdout.write(new TextEncoder().encode("child\n"));
    return { exitCode: 0 };
  } });
  try {
    const result = await shell.exec('f() { { delayed & } >/out; }; f; wait; pass </out');
    assert.equal(result.stdout, "child\n");
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("background review: redirected async pipeline releases command substitution capture", async () => {
  const { shell, commands } = setup();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  commands.register({ name: "hold", async execute({ signal }) {
    await new Promise<void>((resolve, reject) => {
      const aborted = (): void => reject(signal.reason);
      if (signal.aborted) aborted();
      else signal.addEventListener("abort", aborted, { once: true });
      void held.then(() => { signal.removeEventListener("abort", aborted); resolve(); });
    });
    return { exitCode: 0 };
  } });
  commands.register({ name: "release", execute() { release(); return { exitCode: 0 }; } });
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error("Command substitution retained a redirected pipeline writer")), 1000);
  try {
    const result = await shell.exec('value=$(hold | hold >/out &); release; args "$value"', { signal: controller.signal });
    assert.equal(result.stdout, '[""]');
    assert.equal(result.stderr, "");
  } finally { clearTimeout(deadline); release(); await shell.dispose(); }
});

for (const operand of ["nope", "0x1", "1e0", " 1", ""]) test(`background review: wait rejects nondecimal PID ${JSON.stringify(operand)}`, async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec(`false & wait '${operand}'; say $?`);
    assert.equal(result.stdout, "1\n");
    assert.notEqual(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("background review: wait -p unsets indexed binding before finding no eligible child", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('a=(old second); wait -n -p a; say "$?"; args "${a[@]}"');
    assert.equal(result.stdout, '127\n[]');
    assert.equal(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("background review: wait -p invalid identifier is a binding error", async () => {
  const { shell } = setup();
  try {
    const result = await shell.exec('wait -n -p "a-b"; say $?');
    assert.equal(result.stdout, "1\n");
    assert.notEqual(result.stderr, "");
  } finally { await shell.dispose(); }
});

test("background review: wait -p records explicit child without -n", async () => {
  const { shell } = setup();
  try {
    const actual = await shell.exec('status 7 & p=$!; wait -p result "$p"; args "$?" "$result" "$p"');
    const [status, resultId, childId] = JSON.parse(actual.stdout) as string[];
    assert.equal(status, "7");
    assert.equal(resultId, childId);
    assert.notEqual(resultId, "");
    assert.equal(actual.stderr, "");
  } finally { await shell.dispose(); }
});

for (const reason of [null, 0, Object.freeze({ marker: "background cancellation" })]) test(`background review: cancellation ${JSON.stringify(reason)} preserves identity and awaits cooperative cleanup`, async () => {
  const { shell, commands } = setup();
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  let cleaned = false;
  commands.register({ name: "hold", async execute({ signal, registerCleanup }) {
    const cleanup = async (): Promise<void> => { await new Promise<void>(resolve => setImmediate(resolve)); cleaned = true; };
    registerCleanup?.(cleanup);
    entered();
    await new Promise<void>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return { exitCode: 0 };
  } });
  const controller = new AbortController();
  try {
    const execution = shell.exec("hold & wait", { signal: controller.signal });
    const rejected = assert.rejects(execution, error => error === reason);
    await ready;
    controller.abort(reason);
    await rejected;
    assert.equal(cleaned, true);
  } finally { await shell.dispose(); }
});

test("background review: command budget rejects background launch before command side effects", async () => {
  const { shell, commands } = setup();
  let started = 0;
  commands.register({ name: "mark", execute() { started++; return { exitCode: 0 }; } });
  try {
    await assert.rejects(shell.exec("mark &", { limits: { maxCommands: 1 } }), error => error instanceof ShellLimitError && error.limit === "maxCommands");
    assert.equal(started, 0);
  } finally { await shell.dispose(); }
});

test("background review: parallel jobs share the pipeline stage budget", async () => {
  const { shell, commands } = setup();
  commands.register({ name: "hold", async execute({ signal }) {
    await new Promise<void>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    return { exitCode: 0 };
  } });
  try {
    await assert.rejects(shell.exec("hold | pass & hold | pass & wait", { limits: { maxPipelineStages: 3 } }), error => error instanceof ShellLimitError && error.limit === "maxPipelineStages");
  } finally { await shell.dispose(); }
});
