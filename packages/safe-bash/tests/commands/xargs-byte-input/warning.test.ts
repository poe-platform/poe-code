import assert from "node:assert/strict";
import test from "node:test";
import { Shell } from "../../../src/shell/shell.js";
import { ShellLimitError } from "../../../src/shell/types.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { agentCommands } from "../../../src/plugins/index.js";

const warning = "xargs: warning: the -E option has no effect if -0 or -d is used.\n\n";

for (const fixture of [
  { options: "-0 -E END", input: "454e44008000", output: "454e44008000", warning: true },
  { options: "-E END -0", input: "454e4400", output: "454e4400", warning: true },
  { options: "-d : -E END", input: "454e443aff3a", output: "454e4400ff00", warning: true },
  { options: "-0 -E ''", input: "454e4400", output: "454e4400", warning: false },
  { options: "-0 -E END -E ''", input: "454e4400", output: "454e4400", warning: false },
  { options: "-0 -E '' -E END", input: "454e4400", output: "454e4400", warning: true },
  { options: "-0 -r -E END", input: "", output: "", warning: true },
]) test(`GNU ineffective EOF warning: ${fixture.options}`, async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" } }).use(agentCommands());
  try {
    const result = await shell.exec(`xargs ${fixture.options} printf '%s\\0'`, { stdin: Buffer.from(fixture.input, "hex") });
    assert.equal(result.exitCode, 0);
    assert.equal(Buffer.from(result.stdoutBytes).toString("hex"), fixture.output);
    assert.equal(Buffer.from(result.stderrBytes).toString("hex"), Buffer.from(fixture.warning ? warning : "").toString("hex"));
  } finally { await shell.dispose(); }
});

test("warning output shares the Shell byte budget before input admission", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  let acquired = false;
  const stdin = { async *[Symbol.asyncIterator]() { acquired = true; yield Uint8Array.of(128, 0); } };
  try {
    await assert.rejects(shell.exec("xargs -0 -E END echo", { stdin, limits: { maxOutputBytes: Buffer.byteLength(warning) - 1 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.equal(acquired, false);
  } finally { await shell.dispose(); }
});

const nulWarning = "xargs: WARNING: a NUL character occurred in the input.  It cannot be passed through in the argument list.  Did you mean to use the --null option?\n";

for (const fixture of [
  { input: "a\nb\0c\nd\n", output: "[a][b][d]" },
  { input: "a b\0c d\n", output: "[a][b][d]" },
  { input: "a\0b c\0d\0e f", output: "[a][c][f]" },
  { input: "\0a \0b c\n", output: "[][][c]" },
  { input: "'b\0c d' e\n", output: "[b][e]" },
  { input: 'b\0"c d" e\n', output: "[b][e]" },
  { input: "b\\\0c d\n", output: "[b][d]" },
  { input: "b\0c\\ d e\n", output: "[b][e]" },
  { input: "a\0b\tc d\n", output: "[a][c][d]" },
  { input: "a\nb\0c d\ne\n", options: "-L1", format: "[%s][%s]\\n", output: "[a][]\n[b][d]\n[e][]\n" },
  { input: "a\0b c\0d e", options: "-n1", output: "[a][c][e]" },
  { input: "a\0b c\nd\n", options: "-I{}", operands: "'{}'", output: "[a][d]" },
  { input: "a \0b c\nd\n", options: "-I{}", operands: "'{}'", output: "[a ][d]" },
  { input: "a b\0c d\n", options: "-E b", output: "[a]" },
  { input: "a\nb\0c\nd\n", options: "-0", output: "[a\nb][c\nd\n]" },
]) for (const source of ["stdin", "fragmented stdin", "argument file", "pipeline"]) {
  test(`GNU embedded NUL: ${JSON.stringify(fixture)}, ${source}`, async () => {
    const fs = new MemoryFileSystem();
    const bytes = new TextEncoder().encode(fixture.input);
    await fs.writeFile("/input", bytes);
    const shell = new Shell({ fs }).use(agentCommands());
    const stdin = source === "fragmented stdin" ? (async function* () { for (const byte of bytes) yield Uint8Array.of(byte); })() : bytes;
    try {
      const command = `xargs ${fixture.options ?? ""} ${source === "argument file" ? "-a /input" : ""} printf '${fixture.format ?? "[%s]"}' ${fixture.operands ?? ""}`;
      const result = await shell.exec(source === "pipeline" ? `cat /input | ${command}` : command, { stdin });
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stdout, fixture.output);
      assert.equal(result.stderr, fixture.options === "-0" ? "" : nulWarning);
    } finally { await shell.dispose(); }
  });
}

test("NUL warning respects the output budget and closes input before child admission", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(agentCommands());
  let closed = false;
  let invoked = false;
  shell.use({ name: "capture", setup({ commands }) { commands.register({ name: "capture", execute() { invoked = true; return { exitCode: 0 }; } }); } });
  const stdin = (async function* () {
    try { yield new TextEncoder().encode("a\0b c\n"); }
    finally { closed = true; }
  })();
  try {
    await assert.rejects(shell.exec("xargs capture", { stdin, limits: { maxOutputBytes: Buffer.byteLength(nulWarning) - 1 } }), error => error instanceof ShellLimitError && error.limit === "maxOutputBytes");
    assert.equal(closed, true);
    assert.equal(invoked, false);
  } finally { await shell.dispose(); }
});
