import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { basicCommands } from "../../../../src/commands/basic.js";
import { createMemoryFileSystem } from "../../../../src/fs/memory/index.js";
import type { ShellExtension } from "../../../../src/shell/extensions.js";
import { Shell } from "../../../../src/shell/shell.js";
import { ShellLimitError } from "../../../../src/shell/types.js";

const referenceBytes = readFileSync(new URL("./function-diagnostic-runtime-reference.json", import.meta.url));
assert.equal(createHash("sha256").update(referenceBytes).digest("hex"), "3a804f9b12c2655f99608c5fe5a82db1a35d8b57297ffdcef1e8fb2842e2fd1a");
const reference = JSON.parse(referenceBytes.toString()) as {
  profile: string;
  executableSha256: string;
  records: { name: string; source: string; nativeSource: string; file?: string; status: number; stdoutBase64: string; stderrBase64: string }[];
};
assert.equal(reference.profile, "primary-5.3");
assert.equal(reference.executableSha256, "a0cfc1af0ff50f6b6e67c638979e2604f1c276c90116937fbaafcabb62ee2b40");

const definition = "origin_fn() {\n:\norigin_missing;\n}\n";
const quote = (source: string): string => `'${source.split("'").join("'\\''")}'`;
const callback: ShellExtension = { name: "origin-callback", create: () => ({ builtins: [{
  name: "origin_eval", execute: context => context.evaluate(context.argumentValues[0]!),
}] }) };

async function setup(file?: string, extensions: readonly ShellExtension[] = [callback]) {
  const fs = createMemoryFileSystem();
  if (file !== undefined) {
    await fs.mkdir("/dev/fd", { recursive: true });
    await fs.writeFile("/dev/fd/3", Buffer.from(file));
  }
  const shell = new Shell({ fs, extensions, env: { LC_ALL: "C" } });
  for (const command of basicCommands()) shell.register(command);
  return shell;
}

const sourced = (file: string): string => `. /dev/fd/3 3<<'ORIGIN_FILE'\n${file}ORIGIN_FILE\n`;
const nestedDeclaration = `:\neval ${quote(definition)}\n`;
const fileEval = `:\n:\neval ${quote(definition)}\n`;
const stdinProgram = `:\n:\n${definition}:\n:\neval origin_fn`;
const scriptProgram = `:\n${definition}:\neval origin_fn`;
const cases: readonly { name: string; source: string; native?: string; file?: string }[] = [
  { name: "nested eval declarations retain both effective line bases", source: `:\n:\neval ${quote(nestedDeclaration)}\n:\neval origin_fn` },
  { name: "callback declarations retain effective nested eval lines", source: `:\n:\norigin_eval ${quote(nestedDeclaration)}\n:\norigin_eval origin_fn`, native: `:\n:\neval ${quote(nestedDeclaration)}\n:\neval origin_fn` },
  { name: "eval declaration inside sourced input retains source path", file: fileEval, source: `${sourced(fileEval)}:\n:\norigin_eval origin_fn`, native: `${sourced(fileEval)}:\n:\neval origin_fn` },
  { name: "sourced declaration called in substitution retains source path", file: definition, source: `${sourced(definition)}:\n:\nprintf '%s' "$(origin_fn)"` },
  { name: "sourced declaration in subshell retains source path", file: definition, source: `${sourced(definition)}:\n:\n(eval origin_fn)` },
  { name: "subshell redefinition does not overwrite parent origin", source: `${definition}(eval ${quote(`:\n:\n${definition}`)}; origin_fn); origin_fn` },
  { name: "nested function declaration retains containing eval origin", source: `:\n:\neval ${quote(`outer() {\n${definition}}\n`)}; outer; eval origin_fn` },
  { name: "redirection context retains definition provenance", source: `{ ${definition}} 2>&1; origin_fn` },
  { name: "command substitution declaration retains definition provenance", source: `:\n:\nprintf '%s' "$(${definition}origin_fn)"` },
  { name: "function execution restores caller diagnostic identity", source: `${definition}origin_fn;\norigin_missing` },
  { name: "sourced definition does not overwrite caller identity", file: definition, source: `${sourced(definition)}origin_fn;\norigin_missing` },
  { name: "command-string child uses function origin independent of argv zero", source: `bash -c ${quote(`${definition}eval origin_fn; origin_missing`)} custom-zero`, native: `"$BASH" -c ${quote(`${definition}eval origin_fn; origin_missing`)} custom-zero` },
  { name: "stdin incremental units retain child name and absolute declaration line", source: `printf '%s' ${quote(stdinProgram)} | bash`, native: `printf '%s' ${quote(stdinProgram)} | (exec -a bash "$BASH")` },
  { name: "script-file child retains target origin", file: scriptProgram, source: "bash /dev/fd/3", native: `"$BASH" /dev/fd/3 3<<'ORIGIN_FILE'\n${scriptProgram}\nORIGIN_FILE` },
  ...[
    "origin_fn(){ origin_missing; }; origin_fn",
    "origin_fn()\n{\norigin_missing;\n}\norigin_fn",
    "origin_fn(){ origin_first; origin_second; }; origin_fn",
    "origin_fn(){\norigin_first\norigin_second\n}; origin_fn",
    "origin_fn(){ origin_first;\n\norigin_second; }; origin_fn",
    "outer(){ origin_fn(){ origin_missing; }; }; outer; origin_fn",
    "origin_fn(){ { origin_missing; }; }; origin_fn",
    "origin_fn() (origin_missing); origin_fn",
    ":\n\norigin_fn(){\norigin_missing;\n};\n\norigin_fn",
    "origin_fn(){ printf '%s' 'first\nlast'; origin_missing; }; origin_fn",
  ].map(body => ({ name: `function reprint layout ${JSON.stringify(body)}`, source: `:\nprintf '%s' "$(${body})"` })),
  ...[
    "origin_fn(){ if true; then origin_missing; fi; }; origin_fn",
    "origin_fn(){ if false; then :; elif true; then origin_missing; else :; fi; }; origin_fn",
    "origin_fn(){ if false; then :; elif false; then :; else origin_missing; fi; }; origin_fn",
    "origin_fn(){ if origin_guard; then :; else origin_missing; fi; }; origin_fn",
    "origin_fn(){ if true\nthen\norigin_first\norigin_second\nfi; }; origin_fn",
    "origin_fn(){ for item in one; do origin_missing; done; }; origin_fn",
    "origin_fn(){ for item in 'first\nlast'; do origin_missing; done; }; origin_fn",
    "origin_fn(){ for item; do origin_missing; done; }; origin_fn one",
    "origin_fn(){ while true; do origin_missing; break; done; }; origin_fn",
    "origin_fn(){ until false; do origin_missing; break; done; }; origin_fn",
    "origin_fn(){ while origin_guard; do :; done; origin_missing; }; origin_fn",
    "origin_fn(){ for item in one; do if true; then origin_first; fi; origin_second; done; origin_last; }; origin_fn",
    "if true; then :; fi; origin_fn(){ origin_missing; }; origin_fn",
    "for item in one; do :; done; origin_fn(){ origin_missing; }; origin_fn",
    "while false; do :; done; origin_fn(){ origin_missing; }; origin_fn",
    "if true; then origin_fn(){ origin_missing; }; fi; origin_fn",
    "origin_fn(){ if (( 1 )); then origin_missing; fi; }; origin_fn",
    "origin_fn(){ if [[ x = x ]]; then origin_missing; fi; }; origin_fn",
    "origin_fn(){ if [[ 'first\nlast' = 'first\nlast' ]]; then origin_missing; fi; }; origin_fn",
    "origin_fn(){ if ((\n1\n)); then origin_missing; fi; }; origin_fn",
    "origin_fn(){ case one in one) origin_missing;; esac; }; origin_fn",
    "origin_fn(){ case two in one) :;; two) origin_missing;; esac; origin_last; }; origin_fn",
    "origin_fn(){ case 'first\nlast' in 'first\nlast') origin_missing;; esac; }; origin_fn",
    "case one in one) :;; esac; origin_fn(){ origin_missing; }; origin_fn",
  ].map(body => ({ name: `compound function layout ${JSON.stringify(body)}`, source: `:\nprintf '%s' "$(${body})"` })),
  ...[
    "origin_fn(){ : <<'END'\npayload\nEND\norigin_missing; }; origin_fn",
    ": <<'END'\npayload\nEND\norigin_fn(){ origin_missing; }; origin_fn",
    "origin_fn(){ origin_missing; } <<'END'\npayload\nEND\norigin_fn",
    "origin_fn(){ if : <<'END'\npayload\nEND\nthen origin_missing; fi; }; origin_fn",
    "origin_fn(){ while : <<'END'\npayload\nEND\ndo origin_missing; break; done; }; origin_fn",
    "origin_fn(){ : <<FIRST <<SECOND\none\nFIRST\ntwo\nSECOND\norigin_missing; }; origin_fn",
    "origin_fn(){ : <<END | :\npayload\nEND\norigin_missing; }; origin_fn",
    "origin_fn(){ : <<END\n$(printf '%s' value)\nEND\norigin_missing; }; origin_fn",
    "origin_fn(){ : <<-END\n\tpayload\n\tEND\norigin_missing; }; origin_fn",
    "origin_fn(){ : <<END | origin_pipe\npayload\nEND\norigin_missing; }; origin_fn",
    "origin_fn(){ if true; then : <<END\npayload\nEND\nfi\norigin_missing; }; origin_fn",
    "origin_fn(){ case one in one) : <<END\npayload\nEND\n;; esac\norigin_missing; }; origin_fn",
    "origin_fn(){ : <<END\nEND\norigin_missing; }; origin_fn",
    "origin_fn(){ : 'first\nlast' <<END\npayload\nEND\norigin_missing; }; origin_fn",
    "origin_fn(){ : <<END\nfirst\\\nlast\nEND\norigin_missing; }; origin_fn",
  ].map(body => ({ name: `heredoc function layout ${JSON.stringify(body)}`, source: `:\nprintf '%s' "$(${body})"` })),
];

assert.equal(reference.records.length, cases.length);
assert.equal(new Set(reference.records.map(record => record.name)).size, cases.length);
for (const fixture of cases) test(`function origin primary 5.3: ${fixture.name}`, async context => {
  const native = reference.records.find(record => record.name === fixture.name);
  assert.ok(native);
  assert.equal(native.source, fixture.source);
  assert.equal(native.nativeSource, fixture.native ?? fixture.source);
  assert.equal(native.file, fixture.file);
  const shell = await setup(fixture.file); context.after(() => shell.dispose());
  const result = await shell.exec(fixture.source);
  assert.equal(result.exitCode, native.status, fixture.source);
  assert.deepEqual(Buffer.from(result.stdoutBytes), Buffer.from(native.stdoutBase64, "base64"), fixture.source);
  assert.deepEqual(Buffer.from(result.stderrBytes), Buffer.from(native.stderrBase64, "base64"), fixture.source);
});

for (const extensions of [[], [callback]]) test(`command-text function identity without oracle, extensions ${extensions.length}`, async context => {
  const shell = await setup(undefined, extensions); context.after(() => shell.dispose());
  const result = await shell.exec(`${definition}origin_fn`);
  assert.equal(result.exitCode, 127);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "shell: line 3: origin_missing: command not found\n");
});

test("sourced callback restores declaration line base without oracle", async context => {
  const shell = await setup(definition); context.after(() => shell.dispose());
  const result = await shell.exec(`${sourced(definition)}:\n:\norigin_eval origin_fn`);
  assert.equal(result.exitCode, 127);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "/dev/fd/3: line 3: origin_missing: command not found\n");
});

for (const reason of [false, 0, "", null]) test(`function diagnostics preserve root cancellation ${String(reason)} and drain cleanup`, async context => {
  const controller = new AbortController();
  let cleanups = 0;
  const lifecycle: ShellExtension = { name: "lifecycle", create: () => ({ builtins: [], start(invocation) {
    invocation.registerCleanup(async () => { await Promise.resolve(); cleanups++; });
  } }) };
  const shell = await setup(undefined, [callback, lifecycle]); context.after(() => shell.dispose());
  await assert.rejects(shell.exec(`${definition}origin_eval origin_fn`, { signal: controller.signal, stderr: { async write() { controller.abort(reason); } } }), error => Object.is(error, reason));
  assert.equal(cleanups, 1);
});

test("function diagnostic bytes use the existing shared output budget", async context => {
  const shell = await setup(); context.after(() => shell.dispose());
  await assert.rejects(shell.exec(`${definition}origin_fn`, { limits: { maxOutputBytes: 2 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
});
