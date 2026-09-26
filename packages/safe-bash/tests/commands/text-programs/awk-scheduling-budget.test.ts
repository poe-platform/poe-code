import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, MemoryFileSystem, Shell, createTextProgramCommands, createStandardCommands } from "../../../src/index.js";
import { runVirtual } from "./helpers.js";

for (const [name, program, expected] of [
  ["builtin print argument preserves prior side effects", '{ x = 0; print x++, tolower("ABC"); print "final x=" x }', "0 abc\nfinal x=1\n"],
  ["nested function print argument preserves call frames", 'function bump_global() { a += 100 } function inspect_val(v) { bump_global(); return v } { a = 5000; a += 5; print "v=" inspect_val(a), "a=" a }', "v=5005 a=5105\n"],
  ["multiple asynchronous print arguments execute in order", 'function bump() { x++; return x } { x = 0; OFS = ":"; ORS = "!"; print x++, bump(), x++, bump(); print x }', "0:2:2:4!4!"],
  ["numeric array overwrite owns its scalar", '{ a = 5000; a += 5; arr[1] = 5000; arr[1] = a; a += 100; print arr[1], a }', "5005 5105\n"],
  ["numeric array overwrite survives scalar increment", '{ a = 5000; a += 5; arr[1] = 5000; arr[1] = a; a++; print arr[1], a }', "5005 5006\n"],
] as const) test(`AWK ${name}`, async () => {
  const result = await runVirtual("awk", { args: [program], stdin: "x\n" });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), expected);
});

for (const fallback of [false, true]) test(`infinite AWK preserves the published snapshot and recovers within the unchanged deadline: timer fallback=${fallback}`, { timeout: 5000 }, async context => {
  if (fallback) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "setImmediate")!;
    Object.defineProperty(globalThis, "setImmediate", { ...descriptor, value: undefined });
    context.after(() => Object.defineProperty(globalThis, "setImmediate", descriptor));
  }
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, commands: new CommandRegistry(createStandardCommands()) });
  shell.use({ name: "budget-regression", setup(host) {
    for (const command of createTextProgramCommands({ maxSteps: 5_000_000 })) host.commands.register(command, { replace: true });
  } });
  context.after(() => shell.dispose());
  await fs.writeFile("/snapshot", Buffer.from("previous complete snapshot\n"));
  const result = await shell.exec(`awk 'BEGIN { print "partial"; while (1) i++; print "complete" }' > /staging && mv /staging /snapshot`);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /execution step limit exceeded/u);
  assert.equal(Buffer.from(await fs.readFile("/staging")).toString(), "partial\n");
  assert.equal(Buffer.from(await fs.readFile("/snapshot")).toString(), "previous complete snapshot\n");
  assert.equal((await shell.exec("printf recovered")).stdout, "recovered");
});

test("AWK retains the ordinary 20,001-row workload at the consumer step budget", { timeout: 5000 }, async () => {
  const result = await runVirtual("awk", { args: [String.raw`BEGIN { for (i = 0; i < 20001; i++) print "- button \"Item" i "\" [ref=e" i "]"; print "- [Snapshot](.playwright-cli/expected.yml)" }`] }, { maxSteps: 5_000_000 });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), Array.from({ length: 20_001 }, (_, i) => `- button "Item${i}" [ref=e${i}]\n`).join("") + "- [Snapshot](.playwright-cli/expected.yml)\n");
});

test("disposal of active AWK drains execution and preserves its rejection", { timeout: 5000 }, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), commands: new CommandRegistry(createTextProgramCommands()) });
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const execution = shell.exec(`awk 'BEGIN { print "started" > "/dev/stderr"; while (1) i++; print "complete" }'`, { stderr: { async write() { started(); } } });
  const outcome = Promise.allSettled([execution]);
  await ready;
  await shell.dispose();
  const [result] = await outcome;
  assert.equal(result!.status, "rejected");
  if (result!.status === "rejected") assert.equal(result.reason.message, "Shell is disposed");
});
