import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { Shell, ShellLimitError, agentCommands, createMemoryFileSystem, writeText } from "../../src/index.js";

function setup() {
  const fs = createMemoryFileSystem();
  const shell = new Shell({ fs }).use(agentCommands());
  const calls: string[] = [];
  shell.use(async (context, next) => { calls.push(context.command); return next(); });
  return { shell, fs, calls };
}

test("literal invoke returns nonzero to its custom caller", async () => {
  const { shell, calls } = setup();
  shell.register({ name: "choose", async execute(context) {
    assert.equal((await context.invoke!("false", [])).exitCode, 1);
    await writeText(context.stdout, "chosen");
    return { exitCode: 0 };
  } });
  const result = await shell.exec("set -e; choose; printf after");
  assert.equal(result.stdout, "chosenafter"); assert.equal(result.exitCode, 0);
  assert.deepEqual(calls, ["set", "choose", "false", "printf"]);
});

test("literal invoke child interpreter honors its own option in tested parent", async () => {
  const { shell } = setup();
  shell.register({ name: "choose", async execute(context) {
    const result = await context.invoke!("bash", ["-ec", "false; printf BAD", "child"]);
    assert.equal(result.exitCode, 1); await writeText(context.stdout, "chosen"); return { exitCode: 0 };
  } });
  const result = await shell.exec("set -e; choose || true; printf after");
  assert.equal(result.stdout, "chosenafter"); assert.equal(result.exitCode, 0);
});

test("e presence only, state isolation across exec and nested child", async () => {
  const { shell } = setup();
  assert.equal((await shell.exec('printf "[%s]" "$-"; set -e; printf "[%s]" "${-}"; bash -c \'printf "[%s]" "$-"\'; printf "[%s]" "$-"')).stdout, "[][e][][e]");
  assert.equal((await shell.exec('printf "[%s]" "$-"')).stdout, "[]");
});

for (const [name, source, limits] of [
  ["commands", "set -e; eval 'true; true; true'", { maxCommands: 3 }],
  ["source", "set -e; eval 'true'", { maxSourceBytes: 22 }],
  ["depth", "set -e; f() { f; }; f", { maxSubstitutionDepth: 3 }],
  ["loops", "set -e; while true; do :; done", { maxLoopIterations: 3 }],
  ["expansion", "set -e; VALUE=abcdef; printf '%s' \"$VALUE\"", { maxExpansionBytes: 4 }],
  ["output", "set -e; env -i printf 1234 | cat", { maxOutputBytes: 7 }],
] as const) test(`errexit never swallows shared ${name} budget`, { timeout: 2000 }, async () => {
  const { shell } = setup();
  await assert.rejects(shell.exec(source, { limits }), error => error instanceof ShellLimitError);
});

test("pipeline succeeds at unchanged producer plus consumer byte budget", async () => {
  const { shell } = setup();
  const result = await shell.exec("set -e; env -i printf 1234 | cat", { limits: { maxOutputBytes: 8 } });
  assert.equal(result.stdout, "1234"); assert.equal(result.exitCode, 0);
});

test("parent cancellation identity survives tested context", { timeout: 2000 }, async () => {
  const { shell } = setup(); const controller = new AbortController(); const reason = new Error("cancel-errexit");
  shell.register({ name: "cancel", execute() { controller.abort(reason); throw reason; } });
  await assert.rejects(shell.exec("set -e; cancel || printf BAD", { signal: controller.signal }), error => error === reason);
});

test("cancellation during delayed command observes late rejection", { timeout: 2000 }, async () => {
  const { shell } = setup(); const controller = new AbortController(); const reason = new Error("cancel-late");
  const late = new Error("late-command"); const unhandled: unknown[] = [];
  const listener = (error: unknown) => { unhandled.push(error); };
  process.on("unhandledRejection", listener);
  shell.register({ name: "later", async execute() { controller.abort(reason); await delay(15); throw late; } });
  try {
    await assert.rejects(shell.exec("set -e; later", { signal: controller.signal }), error => error === reason);
    await delay(30); assert.deepEqual(unhandled, []);
  } finally { process.off("unhandledRejection", listener); }
});

test("delayed pipeline consumer drains before aggregate exit", { timeout: 2000 }, async () => {
  const { shell, calls } = setup(); let received = "";
  shell.register({ name: "drain", async execute(context) {
    for await (const bytes of context.stdin) { await delay(2); received += Buffer.from(bytes).toString(); await context.stdout.write(bytes); }
    return { exitCode: 7 };
  } });
  const result = await shell.exec("set -e; printf data | drain; printf BAD");
  assert.equal(result.exitCode, 7); assert.equal(result.stdout, "data"); assert.equal(received, "data");
  assert.equal(calls.filter(name => name === "printf").length, 1);
});

test("failed redirected group stops but earlier file effect is retained", async () => {
  const { shell, fs } = setup();
  const result = await shell.exec("set -e; printf before > kept; { true; } > missing/out; printf BAD");
  assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
  assert.equal(Buffer.from(await fs.readFile("/kept")).toString(), "before");
});

test("source cleanup after errexit preserves parent literal caller", async () => {
  const { shell, fs } = setup(); await fs.writeFile("/body", Buffer.from("set -e; false; printf BAD\n"));
  shell.register({ name: "choose", async execute(context) {
    assert.equal((await context.invoke!("bash", ["-c", ". /body", "child"])).exitCode, 1);
    return { exitCode: 0 };
  } });
  assert.equal((await shell.exec("choose; printf after")).stdout, "after");
});

test("binary stdin and default origin survive nested literal invocation", async () => {
  const { shell } = setup(); const seen: boolean[] = [];
  shell.register({ name: "witness", async execute(context) { seen.push(context.stdinIsDefault === true); for await (const bytes of context.stdin) await context.stdout.write(bytes); return { exitCode: 0 }; } });
  shell.register({ name: "bridge", execute: context => context.invoke!("witness", [], { stdout: context.stdout }) });
  const binary = Uint8Array.of(0, 255, 10, 128);
  const result = await shell.exec("set -e; bridge", { stdin: binary });
  assert.deepEqual(result.stdoutBytes, binary); assert.deepEqual(seen, [false]);
  await shell.exec("set -e; bridge"); assert.deepEqual(seen, [false, true]);
});

for (const header of ["#!/bin/bash -e", "#!/usr/bin/bash -ee"]) test(`single optional shebang argument ${header}`, async () => {
  const { shell, fs } = setup();
  await fs.writeFile("/script", Buffer.from(`${header}\nprintf '[%s][%s]' "$1" "$2"; false; printf BAD\n`), { mode: 0o755 });
  const result = await shell.exec("/script '' 'a b'; printf after");
  assert.equal(result.exitCode, 0); assert.equal(result.stdout, "[][a b]after"); assert.equal(result.stderr, "");
});

test("explicit interpreter does not apply file header option twice", async () => {
  const { shell, fs } = setup();
  await fs.writeFile("/script", Buffer.from("#!/bin/bash -e\nfalse; printf body\n"));
  assert.equal((await shell.exec("bash +e /script")).stdout, "body");
  const result = await shell.exec("bash -e /script"); assert.equal(result.exitCode, 1); assert.equal(result.stdout, "");
});

for (const [header, expected] of [
  ["#!/usr/bin/env bash -e", [127, "", "env: bash -e: command not found\n"]],
  ["#!/usr/bin/env -S bash -e", [0, "BAD", ""]],
] as const) test(`env shebang literal optional argument ${header}`, async () => {
  const { shell, fs } = setup(); await fs.writeFile("/script", Buffer.from(`${header}\nprintf BAD\n`), { mode: 0o755 });
  try {
    const result = await shell.exec("/script"); assert.deepEqual([result.exitCode, result.stdout, result.stderr], expected);
    assert.deepEqual((await fs.readdir("/")).map(entry => entry.name), ["script"]);
    assert.deepEqual(Buffer.from(await fs.readFile("/script")), Buffer.from(`${header}\nprintf BAD\n`));
  } finally { await shell.dispose(); }
});

for (const header of ["#!/bin/bash -e -e", "#!/bin/bash -c", "#!/bin/bash '-e'", "#!/unknown -e"]) test(`literal shebang refusal ${header}`, async () => {
  const { shell, fs } = setup(); await fs.writeFile("/script", Buffer.from(`${header}\nprintf BAD\n`), { mode: 0o755 });
  const result = await shell.exec("/script"); assert.equal(result.exitCode, 126); assert.equal(result.stdout, ""); assert.match(result.stderr, /unsupported interpreter/u);
});

test("direct permission and invalid UTF8 refusals remain", async () => {
  const { shell, fs } = setup(); await fs.writeFile("/script", Buffer.from("#!/bin/bash -e\ntrue\n"), { mode: 0o644 });
  assert.equal((await shell.exec("/script")).exitCode, 126);
  await fs.writeFile("/binary", Uint8Array.of(255), { mode: 0o755 }); assert.equal((await shell.exec("/binary")).exitCode, 126);
});

for (const command of ["bash -u -c true", "bash +c true", "set -u", "set -o inherit_errexit"]) test(`unimplemented switch stays rejected ${command}`, async () => {
  const { shell } = setup(); const result = await shell.exec(command); assert.equal(result.exitCode, 2); assert.match(result.stderr, /unsupported/u);
});
