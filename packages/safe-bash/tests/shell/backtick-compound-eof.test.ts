import assert from "node:assert/strict";
import test from "node:test";
import { Shell, agentCommands, createMemoryFileSystem, parseShell, ShellSyntaxError, ShellLimitError, type FileSystem } from "../../src/index.js";
import { MockS3Client, S3FileSystem } from "poe-code/safe-fs";
import { hereDocumentWords } from "../../src/shell/parser.js";

const cases = [
  { name: "bare if", body: "if", value: "", status: 2 },
  { name: "missing then", body: "if true", value: "", status: 2 },
  { name: "missing if body", body: "if true; then", value: "", status: 2 },
  { name: "missing fi", body: "if true; then true", value: "", status: 2 },
  { name: "while condition", body: "while", value: "", status: 2 },
  { name: "until body", body: "until true; do", value: "", status: 2 },
  { name: "for body", body: "for item; do", value: "", status: 2 },
  { name: "empty brace group", body: "{", value: "", status: 2 },
  { name: "case clauses", body: "case item in", value: "", status: 2 },
  { name: "case header missing in", body: "case item", value: "", status: 2 },
  { name: "for header missing do", body: "for item", value: "", status: 2 },
  { name: "for word list missing separator", body: "for item in a", value: "", status: 2 },
  { name: "nested closed backtick", body: 'inner=\\`if\\`; code=$?; printf "INNER:%s" "$code"', value: "INNER:2", status: 0 },
  { name: "same input unit prefix stays unexecuted", body: "printf prior; if", value: "", status: 2 },
  { name: "complete input unit output survives", body: "printf prior\nif", value: "prior", status: 2 },
  { name: "semicolon newline output survives", body: "printf prior;\nif", value: "prior", status: 2 },
  { name: "quoted newline is not an input unit boundary", body: 'printf "hidden\ntext"; if', value: "", status: 2 },
  { name: "complete compound prefix survives", body: '{ printf prior; }\nif', value: "prior", status: 2 },
  { name: "complete heredoc prefix survives", body: 'cat <<EOF\nprior\nEOF\nif', value: "prior", status: 2 },
  { name: "complete input unit effects survive", body: "printf saved > /before\nif", value: "", status: 2, before: true },
  { name: "earlier exit skips later input unit", body: "printf prior; exit 7\nif", value: "prior", status: 7, quiet: true },
] as const;

for (const backend of ["memory", "s3"] as const) {
  for (const specimen of cases) test(`closed backtick compound EOF: ${backend}: ${specimen.name}`, async () => {
    const fs: FileSystem = backend === "memory" ? createMemoryFileSystem()
      : new S3FileSystem({ transport: new MockS3Client({ buckets: ["bucket"] }), bucket: "bucket" });
    const source = 'printf "BEFORE\\n"; value=`' + specimen.body + '`; code=$?; printf "STATUS:%s VALUE:<%s>\\n" "$code" "$value"; printf "AFTER\\n"';
    assert.doesNotThrow(() => parseShell(source));
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, `BEFORE\nSTATUS:${specimen.status} VALUE:<${specimen.value}>\nAFTER\n`);
      if ("quiet" in specimen) assert.equal(result.stderr, "");
      else assert.match(result.stderr, /command substitution: line \d+: syntax error: unexpected end of file\n/u);
      if ("before" in specimen) assert.equal(Buffer.from(await fs.readFile("/before")).toString(), "saved");
    } finally { await shell.dispose(); }
  });
  test(`closed backtick compound EOF retains substitution depth: ${backend}`, async () => {
    const fs: FileSystem = backend === "memory" ? createMemoryFileSystem()
      : new S3FileSystem({ transport: new MockS3Client({ buckets: ["bucket"] }), bucket: "bucket" });
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      await assert.rejects(shell.exec('value=`if`', { limits: { maxSubstitutionDepth: 0 } }), error => error instanceof ShellLimitError && error.limit === "maxSubstitutionDepth");
      await assert.rejects(shell.exec('value=`inner=\\`if\\``', { limits: { maxSubstitutionDepth: 1 } }), error => error instanceof ShellLimitError && error.limit === "maxSubstitutionDepth");
    } finally { await shell.dispose(); }
  });
  for (const [source, line] of [
    ['value=`if`', 2],
    ['\nvalue=`if`', 3],
    ['value=`\nif\n`', 5],
    ['\nvalue=`\nif\n`', 6],
    ['value=`printf prior\nif`', 4],
    ['value=`printf "%s" \\`if\\``', 2],
  ] as const) test(`compound EOF GNU 5.2 diagnostic line: ${backend}: ${line}: ${JSON.stringify(source)}`, async () => {
    const fs: FileSystem = backend === "memory" ? createMemoryFileSystem()
      : new S3FileSystem({ transport: new MockS3Client({ buckets: ["bucket"] }), bucket: "bucket" });
    const shell = new Shell({ fs }).use(agentCommands());
    try {
      const result = await shell.exec(source);
      assert.equal(result.stderr, `shell: command substitution: line ${line}: syntax error: unexpected end of file\n`);
    } finally { await shell.dispose(); }
  });
  test(`compound EOF retains cancellation and prior child effects: ${backend}`, async () => {
    const fs: FileSystem = backend === "memory" ? createMemoryFileSystem()
      : new S3FileSystem({ transport: new MockS3Client({ buckets: ["bucket"] }), bucket: "bucket" });
    const controller = new AbortController(), reason = new Error("cancel before deferred compound EOF");
    const shell = new Shell({ fs }).use(agentCommands());
    shell.register({ name: "cancel", execute() { controller.abort(reason); return { exitCode: 0 }; } });
    try {
      await assert.rejects(shell.exec('value=`printf saved > /before; cancel\nif`; printf wrong > /after', { signal: controller.signal }), error => error === reason);
      assert.equal(Buffer.from(await fs.readFile("/before")).toString(), "saved");
      await assert.rejects(fs.stat("/after"), { code: "ENOENT" });
    } finally { await shell.dispose(); }
  });
}

for (const source of [
  "if", "value=$(if)", "value=`if", "value=`value=$(if)`",
  "value=`if true; then printf |`", "value=`if true; then printf >`", "value=`if true; then [[`",
  "value=`if ; then true; fi`", "value=`printf |`", "value=`printf >`", 'value=`printf "unterminated`',
  "value=`(`", "value=`for`", "value=`for 1`", "value=`for ;`", "value=`case`", "value=`case item in a`", "value=`case item in a|`", "value=`case item in (`", "value=`case item in a ;`", "value=`if true; then cat <<EOF\nbody`",
]) test(`compound EOF exclusions remain parse errors: ${source}`, () => {
  assert.throws(() => parseShell(source), ShellSyntaxError);
});

test("heredoc compound EOF keeps its original failed-substitution path", () => {
  const words = [...hereDocumentWords({ delimiter: "EOF", quoted: false, stripTabs: false, offset: 0, depth: 0, body: "`if`", endLine: 2 }, 1, false, [])];
  assert.equal(words[0]!.parts[0]!.kind, "failed-substitution");
});

test("compound EOF never bypasses syntax nesting limits", () => {
  assert.throws(() => parseShell('value=`' + 'if true; then '.repeat(65) + '`'), error => error instanceof ShellSyntaxError && error.reason === "Syntax nesting exceeds 64");
});
