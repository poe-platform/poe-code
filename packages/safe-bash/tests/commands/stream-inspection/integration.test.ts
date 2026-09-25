import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CommandRegistry, type PluginHost } from "../../../src/contracts/index.js";
import { createMemoryFileSystem } from "../../../src/fs/memory/index.js";
import { createRealFileSystem } from "../../../src/fs/real/index.js";
import { Shell } from "../../../src/shell/index.js";
import { ShellLimitError } from "../../../src/shell/types.js";
import { standardCommands } from "../../../src/commands/index.js";
import { createStreamInspectionCommands, streamInspectionCommands } from "../../../src/commands/stream-inspection/index.js";
import { agentCommands } from "../../../src/plugins/index.js";

test("agentCommands: tac regex reverses VFS files and piped stdin", async () => {
  const fs = createMemoryFileSystem();
  await fs.mkdir("/work", { recursive: true });
  await fs.writeFile("/work/input", Buffer.from("a:b::c\n"));
  const shell = new Shell({ fs, cwd: "/work" }).use(agentCommands());
  try {
    for (const source of ["tac -r -s :+ input", "cat input | tac --regex --separator=:+"]) {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, "c\n:b:a:");
    }
  } finally { await shell.dispose(); }
});

test("strings custom separators replace every newline through agentCommands", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/input", Buffer.from("abc\0def\0"));
  await fs.writeFile("/ending", Buffer.from("xy\0ghi"));
  const shell = new Shell({ fs }).use(agentCommands());
  try {
    for (const [args, expected] of [
      ["--output-separator=: -n3 input", "abc:def:"],
      ["--output-separator ':' -n3 input", "abc:def:"],
      ["-s ':' -n3 input", "abc:def:"],
      ["-s:: -n3 input ending", "abc::def::ghi::"],
      ["--output-separator='' -n3 input", "abcdef"],
      ["-s first -s '海' -n3 input", "abc海def海"],
      ["-fs ':' -td -n3 input", "input:       0 abc:input:       4 def:"],
      ["-n3 input", "abc\ndef\n"],
    ]) {
      const result = await shell.exec(`strings ${args}`);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    }
    const stdin = await shell.exec("strings -s ':' -n3", { stdin: Buffer.from("abc\0def") });
    assert.equal(stdin.exitCode, 0, stdin.stderr);
    assert.equal(stdin.stdout, "abc:def:");
    const missing = await shell.exec("strings -s");
    assert.equal(missing.exitCode, 1);
    assert.equal(missing.stdout, "");
  } finally { await shell.dispose(); }
});

test("strings octal alias and whitespace controls preserve native output bytes", async () => {
  const fs = createMemoryFileSystem();
  await fs.writeFile("/offsets", Buffer.from("\0ControlOne\0ControlTwo\0"));
  await fs.writeFile("/whitespace", Buffer.from("\0Control\nInside\r\nEnd\0"));
  const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(agentCommands());
  try {
    for (const [args, expected] of [
      ["-o offsets", "      1 ControlOne\n     14 ControlTwo\n"],
      ["-fo offsets", "offsets:       1 ControlOne\noffsets:      14 ControlTwo\n"],
      ["-o -td offsets", "      1 ControlOne\n     12 ControlTwo\n"],
      ["-tx -o offsets", "      1 ControlOne\n     14 ControlTwo\n"],
      ["-otx offsets", "      1 ControlOne\n      c ControlTwo\n"],
      ["-to -td offsets", "      1 ControlOne\n     12 ControlTwo\n"],
      ["-w whitespace", "Control\nInside\r\nEnd\n"],
      ["--include-all-whitespace whitespace", "Control\nInside\r\nEnd\n"],
      ["-ow -s ':' whitespace", "      1 Control\nInside\r\nEnd:"],
      ["whitespace", "Control\nInside\n"],
    ] as const) {
      const result = await shell.exec(`strings ${args}`);
      assert.equal(result.exitCode, 0, `${args}: ${result.stderr}`);
      assert.equal(result.stderr, "");
      assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(expected));
    }
    for (const args of ["-w", "--include-all-whitespace"]) {
      const result = await shell.exec(`strings ${args}`, { stdin: Buffer.from("\0a\t\n\v\f\rb\0\x01\x7f\xffxyz\0") });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, "a\t\n\v\f\rb\n");
    }
    const invalid = await shell.exec("strings -tz -o offsets");
    assert.equal(invalid.exitCode, 1);
    assert.equal(invalid.stdout, "");
    assert.equal(invalid.stderr, "strings: invalid radix 'z'\n");
    for (const [encoding, width, little] of [["l", 2, true], ["b", 2, false], ["L", 4, true], ["B", 4, false]] as const) {
      const text = "\0Control\nInside\r\nEnd\0";
      const bytes = new Uint8Array(text.length * width);
      for (let index = 0; index < text.length; index++) bytes[index * width + (little ? 0 : width - 1)] = text.charCodeAt(index);
      const result = await shell.exec(`strings -e${encoding} -wo`, { stdin: bytes });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(`${width.toString(8).padStart(7)} Control\nInside\r\nEnd\n`));
    }
  } finally { await shell.dispose(); }
});

test("opt-in plugin collision preflight and replacement use existing contracts", () => {
  assert.deepEqual(createStreamInspectionCommands().map(command => command.name), ["tac", "expand", "fold", "strings"]);
  const original = { name: "strings", execute: () => ({ exitCode: 42 }) };
  const host: PluginHost = { commands: new CommandRegistry([original]), use() {}, registerFileSystem() {} };
  assert.throws(() => streamInspectionCommands().setup(host), /already registered/u);
  assert.deepEqual(host.commands.list().map(command => command.name), ["strings"]);
  streamInspectionCommands({ replace: true }).setup(host);
  assert.equal(host.commands.list().length, 4); assert.notEqual(host.commands.get("strings")?.execute, original.execute);
});

for (const backend of ["memory", "real"] as const) {
  test(`${backend}: Shell VFS log and binary inspection pipelines`, async () => {
    const directory = backend === "real" ? await mkdtemp(fileURLToPath(new URL("./author-real-", import.meta.url))) : undefined;
    const fs = directory ? await createRealFileSystem({ root: directory }) : createMemoryFileSystem();
    const shell = new Shell({ fs, env: { LC_ALL: "C" } }).use(standardCommands()).use(streamInspectionCommands());
    try {
      const result = await shell.exec("printf 'old\tline\nnew\tline\n' > log; tac log | expand -t4 | fold -bw8 > report; cat report");
      assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stderr, ""); assert.equal(result.stdout, "new line\nold line\n");
      const binary = await shell.exec("printf '\\000MAGIC\\000payload\\000' > artifact; strings -a artifact | tac | head -n1");
      assert.equal(binary.exitCode, 0, binary.stderr); assert.equal(binary.stdout, "payload\n");
      const byteOutput = await shell.exec("printf '\\377\\000x\\nY\\n' | tac | cat > binary; cat binary");
      assert.equal(byteOutput.exitCode, 0, byteOutput.stderr); assert.equal(Buffer.from(byteOutput.stdoutBytes).toString("hex"), "590aff00780a");
      assert.equal(Buffer.from(await fs.readFile("/binary")).toString("hex"), "590aff00780a");
    } finally { await shell.dispose(); if (directory) await rm(directory, { recursive: true }); }
  });
}

test("actual shared shell output budget is not replaced by family limits", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), limits: { maxOutputBytes: 32 } }).use(standardCommands()).use(streamInspectionCommands());
  try {
    await assert.rejects(shell.exec("printf 'a\\tb\\n' | expand -t32 | cat"), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
  } finally { await shell.dispose(); }
});

test("early downstream pipeline closes input without processing full source", async () => {
  const fs = createMemoryFileSystem(); await fs.writeFile("/large", Buffer.from("abcd\tvalue\n".repeat(20000)));
  const shell = new Shell({ fs }).use(standardCommands()).use(streamInspectionCommands());
  try {
    const result = await shell.exec("expand /large | head -c4", { signal: AbortSignal.timeout(3000) });
    assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "abcd");
  } finally { await shell.dispose(); }
});

test("tac -r honors Emacs line/past_end anchors and dot newline exclusions, and tac -s preserves raw non-UTF-8 separators", async () => {
  const shell = new Shell({ fs: createMemoryFileSystem(), env: { LC_ALL: "C" } }).use(standardCommands()).use(streamInspectionCommands());
  try {
    for (const [cmd, expected] of [
      ["printf 'a1\\na2\\na3' | tac -r -b -s '^a'", "a3a2\na1\n"],
      ["printf 'a:\\nb:\\nc:' | tac -r -b -s ':$'", "::\nc:\nba"],
      ["printf 'a::' | tac -r -s ':$'", ":a:"],
      ["printf 'a\\nb' | tac -r -b -s '.'", "ba\n"],
    ] as const) {
      const result = await shell.exec(cmd);
      assert.equal(result.exitCode, 0, cmd + ": " + result.stderr);
      assert.equal(result.stdout, expected, cmd);
    }
    const rawSep = await shell.exec("printf '1\\xff2\\xff3' | tac -s $'\\xff'");
    assert.equal(rawSep.exitCode, 0, rawSep.stderr);
    assert.equal(Buffer.from(rawSep.stdoutBytes).toString("hex"), "3332ff31ff");
  } finally {
    await shell.dispose();
  }
});
