import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { createCommandArguments, toByteSource, type CommandDefinition } from "safe-bash-contracts";
import { createAwkCommand, createAwkCommands, awkCommands } from "./index.js";

async function run(command: CommandDefinition, args: string[], input = "", env: Record<string, string> = {}) {
  const values = createCommandArguments(args);
  let stdout = "", stderr = "";
  const result = await command.execute({
    command: command.name, args: values.args, argumentValues: values, cwd: "/", env,
    fs: createMemoryFileSystem(), stdin: toByteSource(input),
    stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    signal: new AbortController().signal,
  });
  return { ...result, stdout, stderr };
}

test("standalone awk works with only portable filesystem and command contracts", async () => {
  assert.equal(createAwkCommand().name, "awk");
  assert.ok(createAwkCommands().some(command => command.name === "awk"));
  assert.equal(awkCommands().name, "awk-commands");
  const result = await run(createAwkCommand(), ["{ print $2 }"], "left right\n");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "right\n");
});

for (const redirect of ["", " > \"/dev/stdout\""]) {
  for (const [expression, expected] of [
    ['(OFS=":"), "b"', "::b\n"],
    ['"a", (ORS="!\\n")', "a !\n!\n"],
    ['(OFMT="%.2f"), 1/3', "%.2f 0.33\n"],
    ['1/3, (OFMT="%.2f"), 1/3', "0.333333 %.2f 0.33\n"],
  ]) test(`print observes argument side effects: ${expression}${redirect}`, async () => {
    const result = await run(createAwkCommand(), [`BEGIN { print ${expression}${redirect} }`]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  });
}

for (const [program, expected] of [
  ['{ sub(/a.b/, "MATCH"); print }', "MATCH\n"],
  ['{ sub(/a..+b/, "MATCH"); print }', "a😀b\n"],
  ['{ p="a.b"; sub(p, "MATCH"); print }', "MATCH\n"],
] as const) test(`awk matches UTF-8 characters: ${program}`, async () => {
  const command = createAwkCommand();
  for (const env of [{}, { LC_ALL: "C.UTF-8" }]) {
    const result = await run(command, [program], "a😀b\n", env);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

test("awk byte options and C locale override UTF-8 matching with cached programs", async () => {
  const command = createAwkCommand(), program = '{ sub(/a.b/, "MATCH"); print }';
  for (const [args, env, expected] of [
    [[program], {}, "MATCH\n"], [["-b", program], {}, "a😀b\n"],
    [["--characters-as-bytes", program], {LC_ALL:"C.UTF-8"}, "a😀b\n"],
    [[program], {LC_ALL:"C"}, "a😀b\n"], [[program], {}, "MATCH\n"],
  ] as const) {
    const result = await run(command, [...args], "a😀b\n", env);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});

// Exercise the memory-view reader and synchronous output used by Shell.
async function runMemoryAwk(args: string[], files: Record<string, string>, env: Record<string, string> = {}, fs = createMemoryFileSystem()) {
  for (const [path, contents] of Object.entries(files)) await fs.writeFile(path, new TextEncoder().encode(contents));
  const values = createCommandArguments(args);
  let stdout = "", stderr = "", reads = 0;
  const capture = (bytes: Uint8Array) => { stdout += new TextDecoder().decode(bytes); return true; };
  const result = await createAwkCommand().execute({
    command: "awk", args: values.args, argumentValues: values, cwd: "/", env, fs,
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: {
      async write(bytes) { capture(bytes); },
      ...{ writeSync: capture, writeRangeSync(bytes: Uint8Array, length: number) { return capture(bytes.subarray(0, length)); } },
    },
    stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    ...{ _fastMemoryBackingFs: fs, _chargeFastFsOp: () => { reads++; } },
  });
  assert.equal(result.exitCode, 0, stderr);
  assert.ok(reads > 0, "memory-view reader exercised");
  return stdout;
}

test("awk appends exactly once per invocation, including the first fast execution", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/data.txt", new TextEncoder().encode("a:10:20\nb:30:40\n".repeat(40)));
  const args = ["-F:", '{ s += $3; c++ } END { print s >> "/append.txt" }', "/data.txt"];
  for (let invocation = 1; invocation <= 3; invocation++) {
    assert.equal(await runMemoryAwk(args, {}, {}, fs), "");
    assert.equal(new TextDecoder().decode(await fs.readFile("/append.txt")), "2400\n".repeat(invocation));
  }
});

test("awk repeated identical file bytes observe output, environment and filename spelling", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/data.txt", new TextEncoder().encode("a:10:20\nb:30:40\n".repeat(40)));
  for (let invocation = 0; invocation < 3; invocation++) {
    assert.equal(await runMemoryAwk(["-F:", "{ s += $3; c++ } END { print s, c }", "/data.txt"], {}, {}, fs), "2400 80\n");
  }
  const program = String.raw`{ s += $3 } END { printf "%s %s %d\n", ENVIRON["MODE"], FILENAME, s }`;
  for (const [mode, path] of [["prod", "/data.txt"], ["dev", "data.txt"], ["prod", "/data.txt"]]) {
    assert.equal(await runMemoryAwk(["-F:", program, path!], {}, { MODE: mode! }, fs), `${mode} ${path} 2400\n`);
  }
});

test("awk srand without arguments observes the clock on each invocation", async t => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/data.txt", new TextEncoder().encode("a:10:20\n".repeat(80)));
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const args = ["-F:", String.raw`{ s += $3 } END { srand(); printf "%.9f\n", rand() }`, "/data.txt"];
  const first = await runMemoryAwk(args, {}, {}, fs);
  now = 2000;
  const second = await runMemoryAwk(args, {}, {}, fs);
  assert.notEqual(first, second);
  now = 1000;
  assert.equal(await runMemoryAwk(args, {}, {}, fs), first);
});

for (const length of [255, 256, 257, 300, 1024]) {
  for (const flags of [[], ["--trace"]]) test(`awk BEGIN reads ${length}-byte memory files with ${flags.join(" ") || "normal execution"}`, async () => {
    const contents = "10\n".repeat(Math.floor(length / 3)) + " ".repeat(length % 3);
    const records = Math.ceil(length / 3);
    const sum = Math.floor(length / 3) * 10;
    assert.equal(await runMemoryAwk([...flags, 'BEGIN { sum=0 } { sum += $1 } END { print NR, sum }', "/first", "/second"], {
      "/first": contents, "/second": contents,
    }), `${records * 2} ${sum * 2}\n`);
  });
}

for (const output of ['print x', 'printf "%s\\n", x', 'printf "%s %s %s\\n", ENVIRON["SECRET_KEY"], FILENAME, x']) {
  test(`awk repeated memory files preserve invocation output: ${output}`, async () => {
    const program = `{ x += $3 } END { ${output} }`;
    for (const tenant of ["A", "B", "A"]) {
      const path = `/tenant${tenant}.txt`;
      const actual = await runMemoryAwk(["-F:", program, path], { [path]: "a:b:5\n".repeat(100) }, { SECRET_KEY: `secret-${tenant}` });
      assert.equal(actual, output.includes("ENVIRON") ? `secret-${tenant} ${path} 500\n` : "500\n");
    }
  });
}

for (const ending of ["\n", ""]) {
  test(`awk memory-file sums exceed signed 32-bit range and retain the final record (ending ${JSON.stringify(ending)})`, async () => {
    const contents = "a,b,800000000\n".repeat(19) + `a,b,800000000${ending}`;
    assert.equal(await runMemoryAwk([
      "-F,", "{ sum += $3; cnt++ } END { print sum, cnt, NF, $0, $1, $3 }", "/data.csv",
    ], { "/data.csv": contents }), "16000000000 20 3 a,b,800000000 a 800000000\n");
  });

  test(`awk END observes the final unmatched memory-file record (ending ${JSON.stringify(ending)})`, async () => {
    const contents = "a,10,20,30\n".repeat(29) + `b,99,88${ending}`;
    assert.equal(await runMemoryAwk([
      "-F,", "/^a/ { cnt++ } END { print cnt, NF, $0, $1, $3, NR, FNR }", "/data.csv",
    ], { "/data.csv": contents }), "29 3 b,99,88 b 88 30 30\n");
  });
}

test("awk memory-file accumulation preserves large initial values across files", async () => {
  assert.equal(await runMemoryAwk([
    "-F,", "BEGIN { sum=2147483647; cnt=2147483647 } { sum += $3; cnt++ } END { print sum, cnt, NF, $0 }",
    "/first.csv", "/second.csv",
  ], {
    "/first.csv": "a,b,800000000\n".repeat(20),
    "/second.csv": "x,y,800000000\n".repeat(20),
  }), "34147483647 2147483687 3 x,y,800000000\n");
});

for (const flag of ["--help", "-h"]) test(`awk ${flag} prints usage`, async () => {
 const result = await run(createAwkCommand(), [flag]);
 assert.equal(result.exitCode, 0, result.stderr);
 assert.ok(result.stdout.includes("Usage: awk"));
 assert.equal(result.stderr, "");
});
