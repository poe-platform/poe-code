import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/index.js";
import { textProgramCommands } from "../../../src/commands/text-programs/index.js";
import { makeFileSystem } from "./helpers.js";
import { basicCommands } from "../../../src/commands/basic.js";
import { toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { Budget } from "../../../src/commands/text-programs/shared.js";
import { AwkRetention } from "../../../src/commands/text-programs/awk-retention.js";
import { AwkPipes } from "../../../src/commands/text-programs/awk-pipes.js";

for (const [program, expected, stderr] of [
  ['BEGIN { r = system("echo hi"); print r }', "hi\n0\n", ""],
  ['BEGIN { print "before"; print system("echo child; echo error >&2; exit 7"); print "after" }', "before\nchild\n7\nafter\n", "error\n"],
  ['BEGIN { print system(""); print system("false"); print system("true") }', "0\n1\n0\n", ""],
  ['BEGIN { print system("printf café"); print system("echo " ++i); print i }', "café0\n1\n0\n1\n", ""],
  ['BEGIN { system("echo saved > result"); getline value < "result"; print value }', "saved\n", ""],
] as const) {
  test(`awk system executes through the virtual shell: ${program}`, async () => {
    const shell = new Shell({ fs: await makeFileSystem(), cwd: "/work" }).use(textProgramCommands());
    for (const command of basicCommands()) shell.register(command);
    try {
      const result = await shell.exec(`awk '${program}'`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, stderr);
    } finally { await shell.dispose(); }
  });
}

for (const [program, expected] of [
  [`BEGIN { cmd="printf 'one\\ntwo\\n'"; while ((cmd | getline value)>0) print value; print close(cmd); cmd | getline value; print value; close(cmd) }`, "one\ntwo\n0\none\n"],
  [`BEGIN { cmd="sed s/a/A/g"; print "abc" | cmd; print "bar" | cmd; print close(cmd) }`, "Abc\nbAr\n0\n"],
  [`BEGIN { cmd="printf 'x y\\n'"; cmd | getline; print $2,NF,NR; close(cmd) }`, "y 2 0\n"],
  [`BEGIN { cmd="printf 'x\\n'; exit 7"; cmd | getline x; print close(cmd) }`, "7\n"],
] as const) {
  test(`awk virtual command pipe ${program}`, async () => {
    const shell = new Shell({ fs: await makeFileSystem() }).use(textProgramCommands());
    for (const command of basicCommands()) shell.register(command);
    try {
      const quoted = "'" + program.split("'").join("'\\''") + "'";
      const result = await shell.exec(`awk ${quoted}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
    } finally { await shell.dispose(); }
  });
}

test("awk pipe children inherit stdin and finish unclosed output pipes", async () => {
  const shell = new Shell({ fs: await makeFileSystem() }).use(textProgramCommands());
  for (const command of basicCommands()) shell.register(command);
  try {
    const result = await shell.exec(`awk 'BEGIN { "sed -n p" | getline x; print x; close("sed -n p"); print "abc" | "sed s/a/A/" }'`, { stdin: "input\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "input\nAbc\n");
  } finally { await shell.dispose(); }
});

test("awk pipe cleanup interrupts pending getline and joins overlapping closes", async () => {
  let childSignal: AbortSignal | undefined;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const context: CommandContext = {
    command: "awk", args: [], cwd: "/", env: {}, fs: await makeFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
    async invoke(_command, _args, options) {
      childSignal = options!.signal!;
      started();
      await new Promise<void>(resolve => childSignal!.addEventListener("abort", () => resolve(), { once: true }));
      return { exitCode: 0 };
    },
  };
  const retention = new AwkRetention(100);
  const pipes = new AwkPipes(context, new Budget(context, {}), retention);
  const read = pipes.read("waiting", "\n").catch(error => error);
  await ready;
  const close = pipes.close("waiting");
  await pipes.closeAll(true);
  await close;
  await read;
  assert.equal(childSignal!.aborted, true);
  assert.equal(retention.retainedBytes, 0);
});

test("awk pipe queues admit retained bytes before accepting output", async () => {
  const context: CommandContext = {
    command: "awk", args: [], cwd: "/", env: {}, fs: await makeFileSystem(), signal: new AbortController().signal,
    stdin: toByteSource(""), stdout: { async write() {} }, stderr: { async write() {} },
    async invoke(_command, _args, options) { for await (const _chunk of options!.stdin!) { /* drain */ } return { exitCode: 0 }; },
  };
  const retention = new AwkRetention(10);
  const pipes = new AwkPipes(context, new Budget(context, { maxBufferBytes: 1024 }), retention);
  await assert.rejects(pipes.write("sink", "x".repeat(100)), /retained text limit/);
  await pipes.closeAll();
  assert.equal(retention.retainedBytes, 0);
});
