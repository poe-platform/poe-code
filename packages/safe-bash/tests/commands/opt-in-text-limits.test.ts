import assert from "node:assert/strict";
import test from "node:test";
import { settings as tree } from "../../src/commands/tree/options.js";
import { settings as du } from "../../src/commands/du/options.js";
import { settings as column } from "../../src/commands/column/options.js";
import { settings as table } from "../../src/commands/table-text/internal.js";
import { settings as inspection } from "../../src/commands/stream-inspection/shared.js";
import { settings as format } from "../../src/commands/stream-format/shared.js";
import { settings as file } from "../../src/commands/file/shared.js";
import { settings as pr } from "../../src/commands/pr/internal.js";
import { settings as html } from "../../src/commands/html-to-markdown/options.js";
import { resolveJqLimits } from "../../src/commands/structured/limits.js";
import { resolveXmlQueryLimits } from "../../src/commands/xml/limits.js";
import { limitsFor } from "../../src/commands/yq/native-work.js";
import { validateOptions } from "../../src/commands/xan/options.js";
import { createSearchCommands } from "../../src/commands/search/index.js";
import { grepCommands } from "../../src/commands/grep.js";
import { createStructuredCommands } from "../../src/commands/structured/index.js";
import { createTextProgramCommands } from "../../src/commands/text-programs/index.js";
import { Pattern } from "../../src/commands/text-programs/regex.js";
import { createMikeYqCommand } from "../../src/commands/yq/mike.js";
import { Budget as TextBudget } from "../../src/commands/text-programs/shared.js";
import { formatted, string, text } from "../../src/commands/text-programs/awk-values.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { toByteSource, type CommandDefinition } from "../../src/contracts/index.js";

async function run(command: string, args: string[], options: { stdin?: string; commands: readonly CommandDefinition[] }) {
  const stdout: Buffer[] = [], stderr: Buffer[] = [];
  const fs = new MemoryFileSystem();
  await fs.mkdir("/work");
  const result = await options.commands.find(definition => definition.name === command)!.execute({
    command, args, cwd: "/work", env: {}, fs, signal: new AbortController().signal,
    stdin: toByteSource(options.stdin ?? ""),
    stdout: { async write(bytes) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes) { stderr.push(Buffer.from(bytes)); } },
  });
  return { ...result, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
}

for (const [name, resolve] of Object.entries({ tree, du, column, table, inspection, format, file, pr, html,
  jq: (options: { limits?: object }) => resolveJqLimits(options.limits),
  xml: (options: { limits?: object }) => resolveXmlQueryLimits(options.limits),
  yq: (options: { limits?: object }) => limitsFor(options.limits),
  xan: (options: { limits?: object }) => validateOptions(options).limits,
})) {
  test(`${name} budgets are unlimited when omitted and independent when supplied`, () => {
    const defaults = resolve({});
    for (const [key, value] of Object.entries(defaults)) {
      assert.equal(value, Infinity, key);
      const configured = resolve({ limits: { [key]: 123_456_789 } });
      assert.equal(configured[key as keyof typeof configured], 123_456_789, key);
      for (const [other, amount] of Object.entries(configured)) if (other !== key) assert.equal(amount, Infinity, other);
    }
  });
}

test("grep and rg accept lines beyond the old ceiling and honor only selected budgets", async () => {
  const stdin = "x".repeat(1024 * 1024 + 1) + "\n";
  for (const command of ["grep", "rg"]) {
    const args = ["-Fc", "x", "-"];
    const result = await run(command, args, { stdin, commands: command === "rg" ? createSearchCommands({ maxOutputBytes: 2 }) : grepCommands() });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "1\n");
    if (command === "grep") continue;
    const limited = await run(command, args, { stdin: "xxxx\n", commands: createSearchCommands({ maxLineBytes: 3 }) });
    assert.equal(limited.exitCode, 2);
    assert.match(limited.stderr, /line byte limit exceeded/);
  }
  const depth = await run("rg", ["--max-depth", "300", "x", "-"], { stdin: "x\n", commands: createSearchCommands() });
  assert.equal(depth.exitCode, 0, depth.stderr);
});

test("jq admits caller depths above former ceilings and still enforces selected collection limits", async () => {
  const result = await run("jq", ["-n", "[range(0;300)] | length"], {
    commands: createStructuredCommands({ limits: { maxDepth: 300, maxAstDepth: 200 } }),
  });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "300\n");
  const limited = await run("jq", ["-n", "[range(0;4)]"], { commands: createStructuredCommands({ limits: { maxCollectionSize: 3 } }) });
  assert.equal(limited.exitCode, 5);
  assert.match(limited.stderr, /maxCollectionSize/);
});

test("sed accepts more than the former instruction count and enforces an explicit count", async () => {
  const args = ["-n", "p;".repeat(1025)];
  const result = await run("sed", args, { stdin: "x\n", commands: createTextProgramCommands({ maxBufferBytes: 4 }) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "x\n".repeat(1025));
  const limited = await run("sed", ["p;p"], { stdin: "x\n", commands: createTextProgramCommands({ maxProgramInstructions: 1 }) });
  assert.equal(limited.exitCode, 2);
});

test("text regex compilation and awk fields have no implicit ceilings", async () => {
  assert.doesNotThrow(() => new Pattern("(".repeat(65) + "x" + ")".repeat(65)));
  assert.doesNotThrow(() => new Pattern("x{1001}"));
  const result = await run("awk", ['BEGIN { NF=100001; print NF }'], { commands: createTextProgramCommands() });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout, "100001\n");
  const limited = await run("awk", ['BEGIN { NF=4; print NF }'], { commands: createTextProgramCommands({ maxFields: 3 }) });
  assert.equal(limited.exitCode, 2);
});

test("yq expression budgets are opt-in and independent of output budgets", async () => {
  for (const source of [" ".repeat(8193) + ".", "(".repeat(65) + "." + ")".repeat(65)]) {
    const result = await run("yq", [source], { stdin: "1", commands: [createMikeYqCommand({ limits: { maxOutputBytes: 2 } })] });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "1\n");
  }
  const limited = await run("yq", ["((((.))))"], { stdin: "1", commands: [createMikeYqCommand({ limits: { maxExpressionDepth: 3 } })] });
  assert.equal(limited.exitCode, 1);
  assert.match(limited.stderr, /expression depth/);
});

test("awk formatting honors buffers above the old formatter ceiling", () => {
  const width = 32 * 1024 * 1024 + 1;
  const context = { signal: new AbortController().signal } as never;
  const budget = new TextBudget(context, { maxBufferBytes: width });
  assert.equal(formatted(`%${width}s`, [string("x")], value => text(value), budget).length, width);
  const limited = new TextBudget(context, { maxBufferBytes: width - 1 });
  assert.throws(() => formatted(`%${width}s`, [string("x")], value => text(value), limited), /buffer limit/);
});


test("ERE grammar admits nesting, groups, nodes and intervals beyond former ceilings", async () => {
  const { EreLedger } = await import("../../src/commands/regex-execution/ere/limits.js");
  const { compileEre } = await import("../../src/commands/regex-execution/ere/syntax.js");
  for (const pattern of ["(".repeat(65) + "a" + ")".repeat(65), "a".repeat(4097), "a{256}"]) {
    const ledger = new EreLedger({ maxExpansionBytes: Infinity, maxExpansionFields: Infinity });
    await compileEre(pattern, ledger);
  }
});

test("rg pattern budgets cover argv and cumulative patterns independently", async () => {
  for (const args of [["abcd"], ["-e", "ab", "-e", "cd"]]) {
    const result = await run("rg", args, { stdin: "abcd\n", commands: createSearchCommands({ maxPatternBytes: 3 }) });
    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /pattern byte limit/);
  }
});


test("awk floating precision can exceed the native Number formatting ceiling", async () => {
  const commands = createTextProgramCommands();
  for (const [format, expected] of [["%.101f", "1.25" + "0".repeat(99)], ["%.101e", "1.25" + "0".repeat(99) + "e+00"], ["%#.102g", "1.25" + "0".repeat(99)]]) {
    const result = await run("awk", [`BEGIN { printf "${format}", 1.25 }`], { commands });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
});


test("yq argv parsing has no implicit count or byte ceiling", async () => {
  for (const args of [[...Array<string>(4097).fill("--no-doc"), "-n", "1"], ["-n", "--expression", " ".repeat(65537) + "1"]]) {
    const result = await run("yq", args, { commands: [createMikeYqCommand()] });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, "1\n");
  }
});


test("awk high precision preserves integer places and honors exact output budgets", async () => {
  for (const [value, expected] of [[1000, "1000"], [0, "0"], [0.125, "0.125"], [-1000, "-1000"]] as const) {
    const result = await run("awk", [`BEGIN { printf "%.101g", ${value} }`], { commands: createTextProgramCommands() });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout, expected);
  }
  const result = await run("awk", ['BEGIN { printf "%.101f", 1.25 }'], { commands: createTextProgramCommands({ maxBufferBytes: 103 }) });
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stdout.length, 103);
});
