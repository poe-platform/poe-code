import assert from "node:assert/strict";
import { test } from "node:test";
import { ShellLimitError } from "../../src/shell/index.js";
import { runVirtualScript } from "../shell-stress/helpers.js";
import { setup } from "./helpers.js";

test("nested heredoc punctuation is literal, not Bash 3.2 parser syntax", async () => {
  const fixture = { name: "nested punctuation", script: "printf '<%s>' \"$(cat <<'EOF'\n) ; \"\nEOF\n)\"" };
  const actual = await runVirtualScript(fixture);
  assert.equal(actual.stdout, '<) ; ">');
  assert.equal(actual.stderr, "");
  assert.equal(actual.exitCode, 0);
  assert.deepEqual(actual.files, {});
});

for (const [source, status, stdout = "", files = []] of [
  ["say ran >marker; pass <<\n", 2],
  ["say ran >marker; pass <<EOF\n$(true |)\nEOF\n", 1, "", ["marker"]],
  ["say ran >marker; false && pass <<EOF\n${bad\nEOF\n", 1, "", ["marker"]],
  ["say ran >marker; pass <<EOF\nbody\nEOF\nif true; then", 2, "body\n", ["marker"]],
  ["say ran >marker; say \"$(pass <<EOF)\"", 2],
  ["say ran >marker; pass <<$'EOF'\ntext\n$EOF\n", 2],
  ['say ran >marker; pass <<$"EOF"\ntext\n$EOF\n', 2],
] as const) {
  test(`heredoc collection versus deferred body error timing: ${JSON.stringify(source)}`, async () => {
    const { shell, fs } = setup();
    const result = await shell.exec(source, { signal: AbortSignal.timeout(2000) });
    assert.equal(result.exitCode, status);
    assert.equal(result.stdout, stdout);
    assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name), files);
    if (files.some((file) => file === "marker")) assert.equal(new TextDecoder().decode(await fs.readFile("/marker")), "ran\n");
  });
}

test("heredoc source, expansion, substitution and command limits", async () => {
  for (const [source, limits, limit] of [
    ["pass <<EOF\ntext\nEOF\n", { maxSourceBytes: 4 }, "maxSourceBytes"],
    ["pass <<EOF\n$VALUE\nEOF\n", { maxExpansionBytes: 4 }, "maxExpansionBytes"],
    ["pass <<'EOF'\n12345\nEOF\n", { maxExpansionBytes: 4 }, "maxExpansionBytes"],
    ["pass <<EOF\n$(say text)\nEOF\n", { maxSubstitutionDepth: 0 }, "maxSubstitutionDepth"],
    ["pass <<EOF\n$(say text)\nEOF\n", { maxCommands: 1 }, "maxCommands"],
    ["pass <<EOF\n12345\nEOF\n", { maxOutputBytes: 4 }, "maxOutputBytes"],
  ] as const) {
    const { shell } = setup();
    await assert.rejects(shell.exec(source, { env: { VALUE: "12345" }, limits, signal: AbortSignal.timeout(2000) }),
      (error) => error instanceof ShellLimitError && error.limit === limit);
  }
});

test("heredoc expansion cancellation stops waiting on host work", { timeout: 2000 }, async () => {
  const { shell } = setup();
  const controller = new AbortController();
  const reason = new Error("cancel heredoc");
  shell.register({ name: "blocked", execute() { controller.abort(reason); return new Promise(() => undefined); } });
  await assert.rejects(shell.exec("pass <<EOF\n$(blocked)\nEOF\n", { signal: controller.signal }), (error) => error === reason);
});

test("heredoc substitutions use UTF-8 strings, discard NUL, and retain literal Unicode", async () => {
  const { shell } = setup();
  const result = await shell.exec("pass <<EOF\n$(bytes)\né\nEOF\n");
  assert.deepEqual(result.stdoutBytes, new TextEncoder().encode("�é�\né\n"));
  assert.equal(result.exitCode, 0);
});

test("EOF-terminated heredocs append the incomplete physical line and warn", async () => {
  for (const [source, stdout] of [["pass <<EOF\nlast", "last\n"], ["pass <<EOF", ""], ["pass <<EOF\n", ""]]) {
    const { shell } = setup();
    const result = await shell.exec(source!);
    assert.equal(result.stdout, stdout);
    assert.equal(result.exitCode, 0);
    assert.match(result.stderr, /warning: here-document.*end-of-file/u);
  }
});

test("closed heredoc descriptor rejects without destroying a live duplicate", async () => {
  const { shell } = setup();
  const result = await shell.exec("{ pass <&3; pass <&4; } 3<<EOF 4<&3 3<&-\ntext\nEOF\n");
  assert.equal(result.stdout, "text\n");
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /Bad file descriptor/u);
});

for (const expansion of ["${VALUE:?stop}", "$((1/0))"]) {
  test(`heredoc expansion failure is a redirection failure: ${expansion}`, async () => {
    const source = `cat 2>errors <<EOF\n${expansion}\nEOF\nstatus=$?; printf after >marker; exit "$status"`;
    const actual = await runVirtualScript({ name: "heredoc expansion failure", script: source });
    assert.equal(actual.exitCode, expansion.startsWith("${") ? 127 : 1);
    assert.equal(actual.stdout, "");
    assert.equal(actual.stderr, "");
    assert.deepEqual(Object.keys(actual.files).sort(), ["errors", "marker"]);
    const errorFile = actual.files.errors!;
    assert.ok(errorFile.type === "file");
    assert.match(Buffer.from(errorFile.base64, "base64").toString(), /VALUE: stop|division by 0/u);
  });
}
