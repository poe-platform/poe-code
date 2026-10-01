import assert from "node:assert/strict";
import test from "node:test";
import { CommandRegistry, MemoryFileSystem, Shell, createTextProgramCommands, createStandardCommands } from "../../../src/index.js";
import { Budget } from "../../../src/commands/text-programs/shared.js";
import { runVirtual } from "./helpers.js";
import { string } from "../../../src/commands/text-programs/awk-values.js";

test("AWK sliced strings preserve every UTF-16 code unit without sharing scalar objects", () => {
  for (const text of ["abcdefghijklmnop", "é漢字😀", "\ud800x\udfff"]) {
    const parent = "q".repeat(100_000) + text + "q".repeat(100_000);
    const value = string(parent.slice(100_000, 100_000 + text.length));
    assert.deepEqual(value, { kind: "string", text });
    assert.notStrictEqual(string(text), value);
  }
});

test("AWK BEGIN reads memory-backed files above the batch threshold", async () => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, commands: new CommandRegistry(createTextProgramCommands()) });
  try {
    await fs.writeFile("/large.txt", new TextEncoder().encode("10\n".repeat(100)));
    for (let i = 0; i < 2; i++) {
      const result = await shell.exec("awk 'BEGIN { sum = 0 } { sum += $1 } END { print NR, sum }' /large.txt");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "100 1000\n");
    }
  } finally {
    await shell.dispose();
  }
});

for (const [name, rows, program, expected] of [
  ["print fallback evaluates arguments once", "a\n", '{ x = 0; print x++, -1; print x }', "0 -1\n1\n"],
  ["large stdout executes once", Array(600).fill("row:123456789012345678901234567890").join("\n") + "\n", '{ print $2 }', "123456789012345678901234567890\n".repeat(600)],
  ["long record fallback preserves sums", [...Array(50).fill("a:10"), "d:10:" + "x".repeat(70)].join("\n") + "\n", '{ sum += $2 } END { print sum }', "510\n"],
  ["unsupported second statement executes once", "a:10\n".repeat(60), '{ count++; total += $2 + 1 } END { print count, total }', "60 660\n"],
  ["yielding batch executes once", "hello:10\n".repeat(128), '/hello/ { count++; sum += $2 } END { print count, sum }', "128 1280\n"],
  ["retained scalar is immutable", "a:10\n".repeat(60), '{ x += 5000; saved = x; x++; print saved, x; exit }', "5000 5001\n"],
] as const) test(`AWK ${name}`, async context => {
  if (name === "yielding batch executes once") {
    const checkpoint = Budget.prototype.checkpointSync;
    context.mock.method(Budget.prototype, "checkpointSync", function (this: Budget) {
      return checkpoint.call(this) ?? Promise.resolve();
    });
  }
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, commands: new CommandRegistry(createTextProgramCommands()) });
  context.after(() => shell.dispose());
  await fs.writeFile("/rows", Buffer.from(rows));
  const result = await shell.exec(`awk -F: '${program}' /rows`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, expected);
});

test("AWK writes redirections and stderr once", async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, commands: new CommandRegistry(createTextProgramCommands()) });
  context.after(() => shell.dispose());
  await fs.writeFile("/rows", Buffer.from("a:10\n"));
  const result = await shell.exec(`awk -F: '{ print $2 >> "/out"; print $2 > "/dev/stderr" }' /rows`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "10\n");
  assert.equal(Buffer.from(await fs.readFile("/out")).toString(), "10\n");
});

test("AWK repeated files preserve output and current environment and filename", async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, commands: new CommandRegistry([...createStandardCommands(), ...createTextProgramCommands()]) });
  context.after(() => shell.dispose());
  await fs.writeFile("/rows", Buffer.from("a:10:20\nb:30:40\n".repeat(40)));
  for (let i = 0; i < 3; i++) {
    const result = await shell.exec(`awk -F: '{ sum += $3; count++ } END { print sum, count }' /rows`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "2400 80\n");
  }
  const result = await shell.exec(`export MODE=prod
awk -F: '{ sum += $3 } END { printf "%s %s %d\\n", ENVIRON["MODE"], FILENAME, sum }' /rows
export MODE=dev
awk -F: '{ sum += $3 } END { printf "%s %s %d\\n", ENVIRON["MODE"], FILENAME, sum }' rows`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "prod /rows 2400\ndev rows 2400\n");
});

test("AWK memory-backed files honor lazy input limits", async context => {
  const fs = new MemoryFileSystem();
  const rows = Buffer.from("a:10:20\nb:30:40\n".repeat(40));
  await fs.writeFile("/rows", rows);
  for (const maxInputBytes of [4, rows.byteLength - 1, rows.byteLength]) {
    const shell = new Shell({ fs, limits: { maxInputBytes }, commands: new CommandRegistry(createTextProgramCommands()) });
    context.after(() => shell.dispose());
    const result = await shell.exec(`awk -F: '{ sum += $3; count++ } END { print sum, count }' /rows`);
    if (maxInputBytes < rows.byteLength) {
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.stdout, "");
    } else {
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "2400 80\n");
    }
  }
});

test("AWK awaits asynchronous stdout and END output exactly once", async context => {
  const fs = new MemoryFileSystem();
  const shell = new Shell({ fs, commands: new CommandRegistry(createTextProgramCommands()) });
  context.after(() => shell.dispose());
  await fs.writeFile("/rows", Buffer.from("a:123456789012345678901234567890\n".repeat(600)));
  const chunks: Uint8Array[] = [];
  const result = await shell.exec(`awk -F: '{ print $2 } END { print "done" }' /rows`, {
    stdout: { async write(chunk) { await Promise.resolve(); chunks.push(chunk.slice()); } },
  });
  const expected = "123456789012345678901234567890\n".repeat(600) + "done\n";
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, expected);
  assert.equal(Buffer.concat(chunks).toString(), expected);
});

test("AWK independent shells have fresh ARGV and field buffers", async context => {
  const shells = [];
  for (let i = 0; i < 2; i++) {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/rows", Buffer.from(i === 0 ? "Alpha:111\n" : "Long-beta:22:extra\n"));
    const shell = new Shell({ fs, commands: new CommandRegistry(createTextProgramCommands()) });
    context.after(() => shell.dispose());
    shells.push(shell);
  }
  assert.equal((await shells[0]!.exec(`awk -F: '{ ARGV[0] = "tenant-secret"; ARGV["token"] = "secret"; ARGV[99] = "extra" }' /rows`)).exitCode, 0);
  const result = await shells[1]!.exec(`awk -F: 'END { print ARGV[0], ARGV["token"], ARGV[99] }' /rows`);
  assert.equal(result.stdout, "awk  \n");
  const results = await Promise.all(shells.map(shell => shell.exec(`awk -F: 'function inspect(v) { return tolower(v) } { print inspect($1), $2; print $1, $2 }' /rows`)));
  assert.equal(results[0]!.stdout, "alpha 111\nAlpha 111\n");
  assert.equal(results[1]!.stdout, "long-beta 22\nLong-beta 22\n");
});

test("AWK numeric expressions retain earlier operands", async () => {
  const result = await runVirtual("awk", { args: ['BEGIN { x = 10; x += 5; print x, (x += 5), (x == (x += 5)); x = 5000; print x, x++, x }'] });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "15 20 0\n5000 5000 5001\n");
});

for (const [name, program, expected] of [
  ["builtin print argument preserves prior side effects", '{ x = 0; print x++, tolower("ABC"); print "final x=" x }', "0 abc\nfinal x=1\n"],
  ["formatted print arguments execute once across asynchronous fallback", 'function bump() { x++; return x } { x = 0; printf "%d %d\\n", x++, bump(); print x }', "0 2\n2\n"],
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
