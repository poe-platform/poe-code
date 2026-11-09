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

for (const group of ["-1", "1x", "9223372036854775808x"]) test(`nl rejects invalid blank group ${group} before output`, async () => {
  const result = await run(toByteSource("\n\nX\n"), {}, ["-ba", "-l", group]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
});

for (const group of ["0", "1", "2", "9007199254740992", "9223372036854775807", "9223372036854775808", "18446744073709551616"]) test(`nl accepts blank group ${group}`, async () => {
  const result = await run(toByteSource("\n\nX\n"), {}, ["-ba", "-l", group]);
  assert.equal(result.exitCode, 0, result.events.join(""));
  assert.equal(result.stdout, group === "0" || group === "1" ? "1|\n2|\n3|X\n" : group === "2" ? "  \n1|\n2|X\n" : "  \n  \n1|X\n");
});

for (const option of ["-h", "-b", "-f", "--header-numbering", "--body-numbering", "--footer-numbering"]) {
  for (const [style, expected] of [
    ["all", "1|A\n2|\n3|B\n"],
    ["all!", "1|A\n2|\n3|B\n"],
    ["text", "1|A\n  \n2|B\n"],
    ["none", "  A\n  \n  B\n"],
    ["p^A$", "1|A\n  \n  B\n"],
  ] as const) test(`nl selects ${option} ${style} by its first character`, async () => {
    const result = await run(toByteSource("\\:\\:\\:\nA\n\nB\n\\:\\:\nA\n\nB\n\\:\nA\n\nB\n"), {}, ["-hn", "-bn", "-fn", option, style]);
    const sections = ["  A\n  \n  B\n", "  A\n  \n  B\n", "  A\n  \n  B\n"];
    sections[option === "-h" || option === "--header-numbering" ? 0 : option === "-b" || option === "--body-numbering" ? 1 : 2] = expected;
    assert.equal(result.exitCode, 0, result.events.join(""));
    assert.equal(result.stdout, "\n" + sections.join("\n"));
  });

  for (const style of ["bogus", "", "All", "p["]) test(`nl rejects ${option} ${JSON.stringify(style)}`, async () => {
    const result = await run(toByteSource("A\n"), {}, [option, style]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.events.some(event => event.startsWith("err:")));
  });
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

for (const [short, long, invalid, valid] of [
  ["b", "body-numbering", "bad", "a"],
  ["h", "header-numbering", "bad", "a"],
  ["f", "footer-numbering", "bad", "a"],
  ["b", "body-numbering", "p[", "t"],
  ["h", "header-numbering", "p[", "n"],
  ["f", "footer-numbering", "p[", "n"],
  ["n", "number-format", "bad", "rn"],
  ["i", "line-increment", "bad", "1"],
  ["v", "starting-line-number", "bad", "1"],
  ["i", "line-increment", "9223372036854775808", "1"],
  ["v", "starting-line-number", "-9223372036854775809", "1"],
  ["w", "number-width", "0", "6"],
  ["l", "join-blank-lines", "-1", "1"],
] as const) test(`nl rejects overwritten --${long}=${invalid} before reading stdin`, async () => {
  for (const args of [
    [`-${short}`, invalid, `-${short}`, valid],
    [`-${short}${invalid}`, `-${short}${valid}`],
    [`--${long}=${invalid}`, `--${long}=${valid}`],
    [`--${long}`, invalid, `--${long}`, valid],
  ]) {
    let consumed = false;
    async function* input() {
      consumed = true;
      yield new TextEncoder().encode("A\n");
    }
    const result = await run(input(), {}, args);
    assert.equal(result.exitCode, 1, args.join(" "));
    assert.equal(result.stdout, "");
    assert.ok(result.events.some(event => event.startsWith("err:nl:")));
    assert.equal(consumed, false);
  }
});

test("nl keeps the last valid value of every repeated numbering option", async () => {
  const result = await run(toByteSource("\\:\\:\\:\nH\n\\:\\:\nA\n\n\n\\:\nF\n"), {}, [
    "-hn", "--header-numbering=a", "-bn", "--body-numbering=a", "-fn", "--footer-numbering=a",
    "-nln", "--number-format=rz", "-i1", "--line-increment=2", "-v1", "--starting-line-number=3",
    "-w6", "--number-width=2", "-l1", "--join-blank-lines=2",
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "\n03|H\n\n03|A\n   \n05|\n\n03|F\n");
});
