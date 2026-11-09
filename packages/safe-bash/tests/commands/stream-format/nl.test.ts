import assert from "node:assert/strict";
import test from "node:test";
import { Pattern } from "../../../src/commands/text-programs/regex.js";
import { Session } from "../../../src/commands/stream-format/shared.js";
import { shell, type NativeCase } from "./helpers.js";

const pages = "head\n\\:\\:\\:\nH\n\n\\:\\:\nA\n\nB\n\\:\nF\n\\:\\:\nC\n";
for (const [options, input, expected] of [
  ["--number-f=rz", "A\n", "000001\tA"],
  ["--number-f rz", "A\n", "000001\tA"],
  ["--body a", "\nA\n", "     1\t\n     2\tA"],
  ["--star 2", "A\n", "     2\tA"],
  ["--no-ren", "A\n\\:\\:\nB\n", "     1\tA\n\n     2\tB"],
] as const) test(`nl command substitution accepts ${options}`, async () => {
  const instance = shell();
  try {
    assert.equal((await instance.exec("cat > /input", { stdin: input })).exitCode, 0);
    for (const command of [`nl ${options} /input`, `cat /input | nl ${options}`]) {
      const result = await instance.exec(`result=$(${command}); status=$?; printf '%s' "$result"; exit "$status"`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, expected);
      assert.equal(result.stderr, "");
    }
  } finally { await instance.dispose(); }
});

for (const option of ["--num=rz", "--num rz", "--unknown"]) test(`nl command substitution rejects ${option}`, async () => {
  const instance = shell();
  try {
    assert.equal((await instance.exec("cat > /input", { stdin: "A\n" })).exitCode, 0);
    const result = await instance.exec(`result=$(nl ${option} /input)`);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.notEqual(result.stderr, "");
  } finally { await instance.dispose(); }
});

for (const options of [
  "-b bad -b a", "-h bad -h a", "-f bad -f a",
  "-b 'p[' -b a", "-h 'p[' -h a", "-f 'p[' -f a",
  "-n bad -n rn", "-i bad -i 1", "-v bad -v 1", "-w 0 -w 6", "-l -1 -l 1",
]) test(`nl substitution rejects overwritten invalid options: ${options}`, async () => {
  const instance = shell();
  try {
    for (const command of [
      `nl ${options} /input`,
      `nl ${options} < /input`,
      `printf 'A\\n' | nl ${options}`,
    ]) {
      const result = await instance.exec(`printf 'A\\n' > /input; captured=$(${command}); status=$?; printf '<%s>' "$captured"; exit "$status"`);
      assert.equal(result.exitCode, 1, command);
      assert.equal(result.stdout, "<>");
      assert.ok(result.stderr.startsWith("nl:"), result.stderr);
    }
  } finally { await instance.dispose(); }
});

test("nl substitution keeps valid repeated numbering options", async () => {
  const instance = shell();
  try {
    const result = await instance.exec("captured=$(printf 'A\\nB\\n' | nl -bn -ba -hn -ha -fn -fa -nln -nrz -i1 -i2 -v1 -v3 -w6 -w2 -l1 -l2); printf '%s\\n' \"$captured\"");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "03\tA\n05\tB\n");
    assert.equal(result.stderr, "");
  } finally { await instance.dispose(); }
});

export const nlCases: readonly NativeCase[] = [
  { args: [], input: "a\n\nb\nlast" }, { args: ["-ba"], input: "\na\n\n" },
  { args: ["-bt"], input: " \n\t\n\n" }, { args: ["-bn"], input: "a\n\nb" },
  { args: [], input: pages }, { args: ["-ha", "-fa"], input: pages }, { args: ["-p", "-ha", "-fa"], input: pages },
  { args: ["-ba", "-l2"], input: "\n\n\nX\n\n\n" },
  { args: ["-ba", "-l2", "-ha"], input: "\n\\:\\:\\:\n\n" },
  { args: ["-v-2", "-i2", "-nrz", "-w4", "-s|"], input: "a\nb\nc\n" },
  { args: ["-nln", "-w2", "-s" , ""], input: "a\n\nb" },
  { args: ["-i0"], input: "a\nb" }, { args: ["-i-1", "-v2"], input: "a\nb\nc\nd" },
  { args: ["-d", ""], input: pages }, { args: ["-d", "@"], input: "a\n@:@:\nb" },
  { args: ["-d", "XYZ", "-ha"], input: "a\nXYZXYZXYZ\nb" },
  { args: ["--body-numbering=a", "--number-width=3", "--number-format=rz", "--number-separator=:"], input: "x\n\n" },
  { args: ["-bp^[[:digit:]]"], input: "12\nabc\n3\n" },
  { args: ["-bp^\\(ab\\)\\1$"], input: "abab\nab\n" }, { args: ["-bp"], input: "\nx" },
  { args: ["-ba"], input: Buffer.from([255, 0, 97, 10]) },
  { args: ["-ba", "-l0"], input: "\n\n\nX\n" }, { args: ["-w0"], failure: true },
  { args: ["-bq"], failure: true }, { args: ["-nxx"], failure: true },
  { args: ["-bp["], failure: true }, { args: ["--bad"], failure: true },
  { args: ["-l-1"], failure: true },
];

test("nl bounded matcher consumes the invocation's shared step budget", async () => {
  const instance = shell({ limits: { maxSteps: 1000 } });
  const result = await instance.exec("nl -bp'a*a*a*a*[bc]'", { stdin: "a".repeat(200) + "\n" });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /step limit/);
  await instance.dispose();
});

test("nl continues over missing files and preserves numbering", async () => {
  const instance = shell();
  const result = await instance.exec("printf 'a\\n' > /a; printf 'b' > /b; nl /a /missing /b");
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "     1\ta\n     2\tb\n");
  assert.match(result.stderr, /missing/);
  await instance.dispose();
});

for (const [options, input, expected] of [
  ["-bp'^a$'", "a\nb\naa\na\n", "1|a\n  b\n  aa\n2|a\n"],
  ["-bp'^\\(ab\\)\\1$'", "abab\nab\n", "1|abab\n  ab\n"],
  ["-hp'^H$' -bp'^B$' -fp'^F$'", "\\:\\:\\:\nH\nx\n\\:\\:\nB\ny\n\\:\nF\nz\n", "\n1|H\n  x\n\n1|B\n  y\n\n1|F\n  z\n"],
] as const) test(`nl awaits actual matching and nonmatching records: ${options}`, async () => {
  const instance = shell();
  try {
    const result = await instance.exec(`nl -w1 -s'|' ${options}`, { stdin: input });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, expected);
  } finally { await instance.dispose(); }
});

test("nl awaited matching preserves NUL and non-UTF-8 record bytes", async () => {
  const instance = shell();
  try {
    const result = await instance.exec("nl -w1 -s'|' -bp'^.$'", { stdin: Uint8Array.of(255, 10, 0, 10, 97, 98, 10) });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdoutBytes, Uint8Array.of(49, 124, 255, 10, 50, 124, 0, 10, 32, 32, 97, 98, 10));
  } finally { await instance.dispose(); }
});

test("nl matching and output share the exact invocation step boundary", async context => {
  let charged = 0;
  const charge = Session.prototype.charge;
  context.mock.method(Session.prototype, "charge", function(this: Session, count = 1) {
    charged += count;
    return charge.call(this, count);
  });
  const source = "nl -w1 -s'|' -bp'^a$'";
  const input = { stdin: "a\nb\na\n" };
  const measured = shell({ limits: { maxSteps: 4096 } });
  try {
    const result = await measured.exec(source, input);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "1|a\n  b\n2|a\n");
  } finally { await measured.dispose(); }
  const exact = charged;
  assert.ok(exact > 1 && exact < 4096);
  for (const maximum of [exact - 1, exact]) {
    const instance = shell({ limits: { maxSteps: maximum } });
    try {
      const result = await instance.exec(source, input);
      assert.equal(result.exitCode, maximum === exact ? 0 : 1);
      if (maximum === exact) { assert.equal(result.stdout, "1|a\n  b\n2|a\n"); assert.equal(result.stderr, ""); }
      else assert.match(result.stderr, /stream-format step limit exceeded/u);
    } finally { await instance.dispose(); }
  }
  context.diagnostic(`exact shared step budget: ${exact}; ${exact - 1} rejects`);
});

for (const reason of [false, Object.freeze({ cancelled: "nl match" })]) test(`nl awaits in-match cancellation without output or reason replacement: ${JSON.stringify(reason)}`, async context => {
  const controller = new AbortController();
  const instance = shell({ limits: { maxSteps: 2048 } });
  let now = 0;
  let written = 0;
  let abort: ReturnType<typeof setImmediate> | undefined;
  context.mock.method(performance, "now", () => now);
  const charge = Session.prototype.charge;
  context.mock.method(Session.prototype, "charge", function(this: Session, count = 1) { now += count; charge.call(this, count); });
  const find = Pattern.prototype.find;
  context.mock.method(Pattern.prototype, "find", function(this: Pattern, ...args: Parameters<typeof find>) {
    abort = setImmediate(() => controller.abort(reason));
    return find.apply(this, args);
  });
  try {
    await assert.rejects(instance.exec("nl -bp'a*a*a*[bc]'", {
      stdin: "aaaaaaaa\n", signal: controller.signal,
      stdout: { async write(bytes) { written += bytes.length; } },
    }), error => error === reason);
    assert.equal(written, 0);
  } finally { if (abort) clearImmediate(abort); await instance.dispose(); }
});

test("nl refuses oversized configured number fields before constructing padding", async () => {
  const instance = shell({ limits: { maxRecordBytes: 1024 } });
  try {
    const result = await instance.exec("nl -w16000000", { stdin: "x\n" });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /number field limit/);
  } finally { await instance.dispose(); }
});

test("nl admits each complete record against remaining output before padding", async () => {
  const instance = shell({ limits: { maxOutputBytes: 12 } });
  try {
    const result = await instance.exec("nl -w4 -nln", { stdin: "a\nb\n" });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "1   \ta\n");
    assert.match(result.stderr, /output limit/);
  } finally { await instance.dispose(); }
});

for (const format of ["ln", "rn", "rz"]) test(`nl streams ${format} padding in bounded chunks`, async () => {
  const instance = shell({ limits: { maxChunkBytes: 64 } });
  try {
    const result = await instance.exec(`nl -w200 -v-2 -n${format}`, { stdin: "x\n\n" });
    assert.equal(result.exitCode, 0, result.stderr);
    const label = format === "ln" ? "-2" + " ".repeat(198) : format === "rz" ? "-" + "0".repeat(198) + "2" : " ".repeat(198) + "-2";
    assert.equal(result.stdout, label + "\tx\n" + " ".repeat(201) + "\n");
  } finally { await instance.dispose(); }
});

test("nl rejects a wide field under a tiny shared stdout quota", async () => {
  const instance = shell();
  let written = 0;
  try {
    await assert.rejects(instance.exec("nl -w16000000", {
      stdin: "x\n", limits: { maxOutputBytes: 1024 },
      stdout: { async write(bytes) { written += bytes.length; } },
    }), { name: "ShellLimitError", limit: "maxOutputBytes" });
    assert.equal(written, 0);
  } finally { await instance.dispose(); }
});

test("nl -d preserves 2-byte default delimiter buffer across 0-byte and >2-byte overrides", async () => {
  const instance = shell();
  try {
    for (const [cmd, input, expected] of [
      ["nl -d '' -d x", "x:\na\n", "\n       a\n"],
      ["nl -d abc -d x", "x:\na\n", "\n       a\n"],
      ["nl -d ab -d x", "xb\na\n", "\n       a\n"],
    ] as const) {
      const result = await instance.exec(cmd, { stdin: input });
      assert.equal(result.exitCode, 0, cmd + ": " + result.stderr);
      assert.equal(result.stdout, expected, cmd);
    }
  } finally { await instance.dispose(); }
});
