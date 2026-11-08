import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryFileSystem, FsError } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type ByteSource, type CommandContext } from "safe-bash-contracts";
import { createNlCommand, type NlCommandsOptions } from "./index.js";

async function run(stdin: ByteSource, options: NlCommandsOptions = {}, args: string[] = [], quota = Infinity) {
  let stdout = "";
  const events: string[] = [];
  const fs = createMemoryFileSystem();
  await fs.writeFile("/next", new TextEncoder().encode("d\n"));
  const values = createCommandArguments(["-w1", "-s|", ...args]);
  const context: CommandContext & { remainingOutputBytes(): number } = {
    command: "nl", args: values.args, argumentValues: values, cwd: "/", env: {}, fs, stdin,
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); events.push("out:" + new TextDecoder().decode(bytes)); } },
    stderr: { async write(bytes) { events.push("err:" + new TextDecoder().decode(bytes)); } },
    signal: new AbortController().signal,
    remainingOutputBytes: () => quota - new TextEncoder().encode(stdout).length,
  };
  const result = await createNlCommand(options).execute(context);
  return { ...result, stdout, events };
}

test("nl flushes complete records before requesting another input chunk", async () => {
  let output = "";
  const values = createCommandArguments(["-w1", "-s|"]);
  async function* input() {
    yield new TextEncoder().encode("a\n");
    yield new TextEncoder().encode("b\nc\npart");
    assert.equal(output, "1|a\n2|b\n3|c\n");
    yield new TextEncoder().encode("ial\n");
  }
  const result = await createNlCommand().execute({
    command: "nl", args: values.args, argumentValues: values, cwd: "/", env: {},
    fs: createMemoryFileSystem(), stdin: input(),
    stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
    stderr: { async write() {} }, signal: new AbortController().signal,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(output, "1|a\n2|b\n3|c\n4|partial\n");
});

for (const args of [[], ["-", "/next"]]) test(`nl retains output before an input error: ${args}`, async () => {
  async function* input() {
    yield new TextEncoder().encode("a\nb\nc\n");
    throw new FsError("EIO", { message: "broken input" });
  }
  const result = await run(input(), {}, args);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "1|a\n2|b\n3|c\n" + (args.length ? "4|d\n" : ""));
  const diagnostic = result.events.findIndex(event => event.startsWith("err:"));
  assert.equal(result.events.slice(0, diagnostic).join("").replaceAll("out:", ""), "1|a\n2|b\n3|c\n");
});

test("nl retains processed records when a later record in the same chunk exceeds its limit", async () => {
  const result = await run(toByteSource("a\nb\nc\ntoolong\n"), { limits: { maxRecordBytes: 4 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "1|a\n2|b\n3|c\n");
});

for (const finite of [false, true]) test(`nl admits complete records against ${finite ? "command" : "shared"} output quota`, async () => {
  const result = await run(toByteSource("a\nb\nc\nd\n"), finite ? { limits: { maxOutputBytes: 15 } } : {}, [], finite ? Infinity : 15);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "1|a\n2|b\n3|c\n");
});

for (const args of [["-bn"], ["-bp."]]) test(`nl counts queued output for ${args}`, async () => {
  const result = await run(toByteSource("a\nb\nc\nd\n"), {}, args, 15);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, args[0] === "-bn" ? "  a\n  b\n  c\n" : "1|a\n2|b\n3|c\n");
});

test("nl admits queued section delimiters against the shared quota", async () => {
  const result = await run(toByteSource("\\:\n".repeat(4)), {}, [], 3);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "\n\n\n");
});
