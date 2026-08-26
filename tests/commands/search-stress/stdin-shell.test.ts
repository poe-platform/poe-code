import assert from "node:assert/strict";
import test from "node:test";
import { collectBytes, toByteSource, type CommandContext } from "../../../src/contracts/index.js";
import { standardCommands } from "../../../src/commands/index.js";
import { searchCommands } from "../../../src/commands/search/index.js";
import { Shell } from "../../../src/shell/index.js";
import { discovered, inputFileSystem } from "./stdin-helpers.js";

async function inputShell() {
  const fs = await inputFileSystem();
  const seen: { metadata: boolean | undefined; args: readonly string[] }[] = [];
  const shell = new Shell({ fs, cwd: "/work" }).use(standardCommands()).use(searchCommands());
  shell.use(async (context, next) => {
    if (context.command === "rg") seen.push({ metadata: context.stdinIsDefault, args: [...context.args] });
    return next();
  });
  const invoke = (context: CommandContext) => { assert(context.invoke); return context.invoke; };
  shell.register({ name: "inherit-input", execute: context => invoke(context)("rg", ["needle"]) });
  shell.register({ name: "replace-empty", execute: context => invoke(context)("rg", ["needle"], { stdin: toByteSource("") }) });
  shell.register({ name: "replace-default", execute: context => invoke(context)("rg", ["needle"], { stdin: toByteSource(""), stdinIsDefault: true }) });
  shell.register({ name: "metadata-only", execute: context => invoke(context)("rg", ["needle"], { stdinIsDefault: false }) });
  shell.register({ name: "forward-input", execute: context => invoke(context)("rg", ["needle"], {
    stdin: context.stdin, ...(context.stdinIsDefault === undefined ? {} : { stdinIsDefault: context.stdinIsDefault }),
  }) });
  shell.register({ name: "exhaust-input", async execute(context) {
    await collectBytes(context.stdin, { maxBytes: 64, signal: context.signal });
    return invoke(context)("rg", ["needle"]);
  } });
  shell.register({ name: "literal-invoke", execute: context => invoke(context)("rg", ["-F", "$(touch injected); needle", "literal ; $.txt"]) });
  return { fs, shell, seen };
}

const cases: readonly [string, string, number, string, boolean][] = [
  ["ordinary default filesystem", "rg needle", 0, discovered, true],
  ["documented empty pipeline", "printf '' | rg needle", 1, "", false],
  ["documented empty redirection", "rg needle < empty", 1, "", false],
  ["documented empty heredoc", "rg needle <<'EOF'\nEOF", 1, "", false],
  ["nonempty pipeline", "printf 'needle\\n' | rg needle", 0, "needle\n", false],
  ["descriptor captures empty file", "rg needle 3<empty 0<&3", 1, "", false],
  ["descriptor restores original default", "rg needle 3<&0 <empty 0<&3", 0, discovered, true],
  ["reversed descriptor setup keeps empty input", "rg needle <empty 3<&0 0<&3", 1, "", false],
  ["output-only redirection preserves default", "rg needle > .result; cat .result", 0, discovered, true],
  ["output redirection preserves empty pipe", "printf '' | rg needle > result", 1, "", false],
  ["explicit file ignores connected empty stdin", "printf '' | rg needle match.txt", 0, "needle\n", false],
  ["explicit dash selects default empty stdin", "rg needle -", 1, "", true],
  ["regexp flag preserves empty stdin", "printf '' | rg -e needle", 1, "", false],
  ["pattern file preserves empty stdin", "printf '' | rg -f .patterns", 1, "", false],
  ["pattern stdin selects filesystem", "printf 'needle\\n' | rg -f -", 0, discovered, false],
  ["files mode ignores connected empty input", "printf '' | rg --files", 0, "empty\nmatch.txt\n", false],
  ["env forwards default metadata", "env rg needle", 0, discovered, true],
  ["nested env forwards default metadata", "env env rg needle", 0, discovered, true],
  ["nested env forwards empty pipe metadata", "printf '' | env env rg needle", 1, "", false],
  ["nested env forwards nonempty pipe metadata", "printf 'needle\\n' | env env rg needle", 0, "needle\n", false],
  ["custom invoke inherits default", "inherit-input", 0, discovered, true],
  ["custom invoke inherits empty pipe", "printf '' | inherit-input", 1, "", false],
  ["custom invoke replacement is nondefault", "replace-empty", 1, "", false],
  ["custom transparent invoke forwards default", "forward-input", 0, discovered, true],
  ["custom transparent invoke forwards empty pipe", "printf '' | forward-input", 1, "", false],
  ["explicit replacement metadata is honored", "printf '' | replace-default", 0, discovered, true],
  ["metadata without replacement does not override inheritance", "metadata-only", 0, discovered, true],
  ["group retains redirected stdin", "{ rg needle; } < empty", 1, "", false],
  ["function retains pipeline stdin", "find_needle() { rg needle; }; printf '' | find_needle", 1, "", false],
  ["substitution retains redirected stdin", "printf '%s' \"$(rg needle < empty)\"", 0, "", false],
];

for (const [name, source, code, stdout, metadata] of cases) test(`stdin shell ${name}`, { timeout: 2000 }, async () => {
  const { shell, seen } = await inputShell();
  const result = await shell.exec(source, { signal: AbortSignal.timeout(1500) });
  assert.equal(result.exitCode, code, result.stderr); assert.equal(result.stdout, stdout); assert.equal(result.stderr, "");
  assert.deepEqual(seen.map(entry => entry.metadata), [metadata]);
});

for (const kind of ["string", "bytes", "source"]) test(`stdin shell explicit empty ${kind}`, async () => {
  const { shell, seen } = await inputShell();
  const stdin = kind === "string" ? "" : kind === "bytes" ? new Uint8Array() : (async function* () {})();
  const result = await shell.exec("rg needle", { stdin });
  assert.equal(result.exitCode, 1, result.stderr); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  assert.deepEqual(seen.map(entry => entry.metadata), [false]);
});

test("stdin shell exhausted source does not revert to filesystem discovery", async () => {
  const { shell, seen } = await inputShell();
  const result = await shell.exec("exhaust-input", { stdin: "needle\n" });
  assert.equal(result.exitCode, 1, result.stderr); assert.equal(result.stdout, ""); assert.equal(result.stderr, "");
  assert.deepEqual(seen.map(entry => entry.metadata), [false]);
});

test("stdin shell zero chunks before data retain nondefault metadata", async () => {
  const { shell, seen } = await inputShell();
  const stdin = (async function* () { yield new Uint8Array(); yield new Uint8Array(); yield Buffer.from("needle\n"); })();
  const result = await shell.exec("rg needle", { stdin });
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "needle\n"); assert.equal(result.stderr, "");
  assert.deepEqual(seen.map(entry => entry.metadata), [false]);
});

test("custom invoke forwards literal argv without shell interpolation", async () => {
  const { fs, shell, seen } = await inputShell();
  await fs.writeFile("/work/literal ; $.txt", Buffer.from("$(touch injected); needle\n"));
  const result = await shell.exec("literal-invoke");
  assert.equal(result.exitCode, 0, result.stderr); assert.equal(result.stdout, "$(touch injected); needle\n"); assert.equal(result.stderr, "");
  assert.deepEqual(seen, [{ metadata: true, args: ["-F", "$(touch injected); needle", "literal ; $.txt"] }]);
  await assert.rejects(fs.lstat("/work/injected"), { code: "ENOENT" });
});
