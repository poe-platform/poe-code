import assert from "node:assert/strict";
import { test } from "node:test";
import { ShellLimitError } from "../../src/shell/index.js";
import { runVirtualScript } from "../shell-stress/helpers.js";
import { setup } from "./helpers.js";

const cases: [string, string][] = [
  ["literal punctuation and whitespace", "cat <<EOF\n  # ' \" ; | & () <> * ? [x] ~\n\nEOF\n"],
  ["empty body", "cat <<EOF\nEOF\nprintf after"],
  ["quoted delimiter", "VALUE=expanded; cat <<'EOF'\n$VALUE $(printf bad) `printf bad` $((1+2)) \\\nEOF\n"],
  ["mixed delimiter quoting", "VALUE=expanded; cat <<E\"O\"'F'\n$VALUE\nEOF\n"],
  ["escaped delimiter", "VALUE=expanded; cat <<E\\OF\n$VALUE\nEOF\n"],
  ["empty delimiter", "cat <<''\ntext\n\nprintf after"],
  ["delimiter parameter is literal", "cat <<$VALUE\ntext\n$VALUE\n"],
  ["quoted command-shaped delimiter", "cat <<\"$(printf E)\"\n$VALUE\n$(printf E)\n"],
  ["command-shaped delimiter is not executed", "cat <<$(printf E)\ntext\n$(printf E)\n"],
  ["scalar expansions", "VALUE='a  b *'; cat <<EOF\n$VALUE ${MISSING:-fallback} $((2+3)) $(printf 'one\\n\\n') `printf two`\nEOF\n"],
  ["body quotes remain literal", "VALUE=ok; cat <<EOF\n'$VALUE' \"$VALUE\" $'text' ${MISSING:-\"word\"}\nEOF\n"],
  ["body escapes", "VALUE=ok; cat <<EOF\n\\$VALUE \\`printf bad\\` \\\\ \\q \\\"\none\\\ntwo\nEOF\n"],
  ["continuation forms delimiter", "cat <<EOF\nEO\\\nF\nprintf after"],
  ["strip only leading tabs", "cat <<-EOF\n\t\tfirst\n \tsecond\n\tthird\n\tEOF\n"],
  ["strip tabs after continuation assembly", "cat <<-EOF\n\tone\\\n\ttwo\nEOF\n"],
  ["quoted tab stripping", "cat <<-'EOF'\n\t$VALUE\\\n\tEOF\n"],
  ["FIFO documents on one command", "cat <<ONE <<TWO\nfirst\nONE\nsecond\nTWO\n"],
  ["FIFO across semicolon", "cat <<ONE; cat <<TWO\nfirst\nONE\nsecond\nTWO\n"],
  ["FIFO across pipeline", "cat <<ONE | cat <<TWO\nfirst\nONE\nsecond\nTWO\n"],
  ["pipeline continuation newline", "cat <<ONE |\nfirst\nONE\ncat\n"],
  ["and-or continuation newline", "cat <<ONE &&\nfirst\nONE\nprintf after\n"],
  ["escaped grammatical newline", "cat <<EO\\\nF \\\n>out\ntext\nEOF\ncat out"],
  ["skipped branches consume but do not expand", "false && cat <<ONE; if false; then cat <<TWO\n$(printf bad >marker)\nONE\n${VALUE:=bad} $(printf bad >marker)\nTWO\nfi; printf '<%s>' \"$VALUE\""],
  ["redirections expand left to right", "cat <<ONE <<TWO\n${VALUE:=first}\nONE\n$VALUE\nTWO\n"],
  ["overridden documents still expand", "cat <<ONE <<TWO\n$(printf first >marker)\nONE\nsecond\nTWO\n"],
  ["descriptor duplicates share read offset", "{ read -r first <&3; cat <&4; printf '%s\\n' \"$first\"; } 3<<EOF 4<&3\nfirst\nsecond\nEOF\n"],
  ["subshell inherits document offset", "{ (read -r first <&3); cat <&3; } 3<<EOF\nfirst\nsecond\nEOF\n"],
  ["input file overrides document", "printf file >input; cat <<EOF <input\ndocument\nEOF\n"],
  ["document overrides input file", "printf file >input; cat <input <<EOF\ndocument\nEOF\n"],
  ["compound pipeline input override", "printf unused | { cat; } <<EOF\ndocument\nEOF\n"],
  ["function invocation gets fresh expanded input", "func() { cat; } <<EOF\n$VALUE\nEOF\nVALUE=one; func; VALUE=two; func"],
  ["loop command gets fresh input", "for VALUE in one two; do cat <<EOF\n$VALUE\nEOF\ndone"],
  ["loop redirect shares input across iterations", "while read -r VALUE; do printf '%s\\n' \"$VALUE\"; done <<EOF\none\ntwo\nEOF\n"],
  ["case branch documents", "case x in x) cat <<EOF\ncase\nEOF\n;; esac"],
  ["document inside substitution", "printf '<%s>' \"$(cat <<EOF\ntext\nEOF\n)\""],
  ["substitution in document contains document", "cat <<OUTER\n$(cat <<INNER\ntext\nINNER\n)\nOUTER\n"],
  ["delimiter comment and tabs", "cat <<EOF\t # comment\ntext\nEOF\n"],
  ["literal backtick delimiter disables expansion", "cat <<`printf E`\n$VALUE\n`printf E`\n"],
  ["literal parameter-shaped delimiter", "cat <<${VALUE:-EOF}\ntext\n${VALUE:-EOF}\n"],
  ["quoted body ignores malformed expansions", "cat <<'EOF'\n${bad $(true |) $((1 + ))\nEOF\n"],
  ["closing one descriptor preserves its duplicate", "{ cat <&4; } 3<<EOF 4<&3 3<&-\ntext\nEOF\n"],
  ["quoted delimiter containing tabs matches before stripping", "cat <<-'\tEOF'\n\ttext\n\tEOF\n"],
  ["empty quote disables expansion", "cat <<EOF''\n$VALUE $(printf bad)\nEOF\n"],
  ["delimiter line has no terminal newline", "cat <<EOF\ntext\nEOF"],
  ["command-shaped delimiter keeps literal brace", "cat <<$(printf {)\ntext\n$(printf {)\n"],
  ["parameter-shaped delimiter keeps literal parenthesis", "cat <<${VALUE:-(}\ntext\n${VALUE:-(}\n"],
];

test("nested heredoc punctuation is literal, not Bash 3.2 parser syntax", async (context) => {
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
