import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem, parseShell, ShellSyntaxError, type FileSystem } from "../../src/index.js";
import { MockS3Client, S3FileSystem } from "poe-code/safe-fs";
import { hereDocumentWords } from "../../src/shell/parser.js";

const scenarios = [
  { name: "outer script continues", child: 'printf "%s" "${value!}"', output: "", status: 1, failure: true },
  { name: "prior child output and effects remain", child: 'printf prior; printf saved > /before; printf "%s" "${value!}"; printf later > /after', output: "prior", status: 1, failure: true, before: true },
  { name: "unquoted malformed word", child: 'printf "%s" ${value!}', output: "", status: 1, failure: true },
  { name: "malformed redirection target", child: 'printf prior; printf wrong > "${value!}"; printf later', output: "prior", status: 1, failure: true },
  { name: "single quoted literal is unchanged", child: "printf '%s' '${value!}'", output: "${value!}", status: 0 },
  { name: "false branch stays lazy", child: 'if false; then printf "%s" "${value!}"; fi; printf kept', output: "kept", status: 0 },
  { name: "short circuit stays lazy", child: 'false && printf "%s" "${value!}"; printf kept', output: "kept", status: 0 },
  { name: "unused function stays lazy", child: 'f() { printf "%s" "${value!}"; }; printf kept', output: "kept", status: 0 },
  { name: "called function fails when evaluated", child: 'f() { printf prior; printf "%s" "${value!}"; printf later; }; f; printf later', output: "prior", status: 1, failure: true },
  { name: "unused default operand stays lazy", child: 'set=kept; printf "%s" "${set:-${value!}}"', output: "kept", status: 0 },
  { name: "selected default operand fails", child: 'printf prior; printf "%s" "${unset:-${value!}}"; printf later', output: "prior", status: 1, failure: true },
  { name: "unused alternate operand stays lazy", child: 'printf "%s" "${unset:+${value!}}"; printf kept', output: "kept", status: 0 },
] as const;

for (const backend of ["memory", "s3"] as const) {
  for (const scenario of scenarios) test(`closed backtick parameter failure: ${backend}: ${scenario.name}`, async () => {
    const fs: FileSystem = backend === "memory" ? createMemoryFileSystem()
      : new S3FileSystem({ transport: new MockS3Client({ buckets: ["bucket"] }), bucket: "bucket" });
    const source = 'printf "BEFORE\\n"; value=`' + scenario.child + '`; code=$?; printf "STATUS:%s VALUE:<%s>\\n" "$code" "$value"; printf "AFTER\\n"';
    assert.doesNotThrow(() => parseShell(source));
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, `BEFORE\nSTATUS:${scenario.status} VALUE:<${scenario.output}>\nAFTER\n`);
      if ("failure" in scenario) assert.match(result.stderr, /bad substitution/u);
      else assert.equal(result.stderr, "");
      if ("before" in scenario) assert.equal(Buffer.from(await fs.readFile("/before")).toString(), "saved");
      await assert.rejects(fs.stat("/after"), { code: "ENOENT" });
    } finally { await shell.dispose(); }
  });
}

for (const source of [
  'printf "%s" "${value!}"',
  'value=$(printf "%s" "${value!}")',
  'value=`value=$(printf "%s" "${value!}")`',
  'value=`printf "%s" "${value!}"',
  'value=`printf "%s" "${array[0]!}"`',
  'value=`printf "%s" "${1!}"`',
  'value=`printf "%s" "${@!}"`',
  'value=`printf "%s" "${value^}"`',
  'value=`printf "%s" "${value^^}"`',
  'value=`printf "%s" "${value,}"`',
  'value=`printf "%s" "${value,,}"`',
  'value=`printf "%s" "${value@Q:-x}"`',
  'value=`cat <(printf "%s" "${value!}")`',
  'cat <(printf "%s" "${value!}")',
  'value=`printf "%s" "${value! later}"`',
  'value=`printf "%s" "${value!$other}"`',
  'value=`printf "%s" "${value!{other}}"`',
  'value=`printf "%s" "${value!"; printf "}"`',
]) test(`parameter failure exclusions stay parse errors: ${source}`, () => {
  assert.throws(() => parseShell(source), ShellSyntaxError);
});

test("supported parameter quoting remains available inside backticks", async () => {
  const source = 'value="a b"; quoted=`printf "%s" "${value@Q}"`; printf "%s" "$quoted"';
  assert.doesNotThrow(() => parseShell(source));
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(agentCommands());
  try {
    const result = await shell.exec(source);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, "'a b'");
  } finally { await shell.dispose(); }
});

test("heredoc backticks retain their failed-substitution parse path", () => {
  const body = '`printf "%s" "${value!}"`';
  const words = [...hereDocumentWords({ delimiter: "EOF", quoted: false, stripTabs: false, offset: 0, depth: 0, body, endLine: 2 }, 1, false, [])];
  assert.equal(words.length, 1);
  assert.equal(words[0]!.parts[0]!.kind, "failed-substitution");
});

test("ordinary backtick failure retains parameter nesting limits", () => {
  const source = 'value=`printf "%s" "' + "${unset:-".repeat(64) + "${value!}" + "}".repeat(64) + '"`';
  assert.throws(() => parseShell(source), (error: unknown) => error instanceof ShellSyntaxError && error.reason === "Syntax nesting exceeds 64");
});

for (const backend of ["memory", "s3"] as const) test(`backtick cancellation precedes malformed expansion: ${backend}`, async () => {
  const fs: FileSystem = backend === "memory" ? createMemoryFileSystem()
    : new S3FileSystem({ transport: new MockS3Client({ buckets: ["bucket"] }), bucket: "bucket" });
  const controller = new AbortController(), reason = new Error("stop child before bad expansion");
  const shell = new Shell({ fs }).use(agentCommands());
  shell.register({ name: "cancel", execute() { controller.abort(reason); return { exitCode: 0 }; } });
  try {
    await assert.rejects(shell.exec('value=`printf saved > /before; cancel; printf "%s" "${value!}"`; printf later > /after', { signal: controller.signal }), error => error === reason);
    assert.equal(Buffer.from(await fs.readFile("/before")).toString(), "saved");
    await assert.rejects(fs.stat("/after"), { code: "ENOENT" });
  } finally { await shell.dispose(); }
});
