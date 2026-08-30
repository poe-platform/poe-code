import assert from "node:assert/strict";
import { test } from "node:test";
import { ShellLimitError } from "../../src/shell/index.js";
import { runBash, runVirtualScript } from "../shell-stress/helpers.js";
import { setup } from "./helpers.js";

const cases: [string, string][] = [
  ["literal scalar", "cat <<<word"],
  ["empty scalar", "cat <<<''"],
  ["unset scalar", "cat <<<\"$MISSING\""],
  ["quoted whitespace and punctuation", "cat <<< '  ; | () # * ? [x] \\  '"],
  ["mixed quote removal", "cat <<<a' b '\"c\"\\ d"],
  ["one added newline even if already present", "cat <<< 'one\ntwo\n'"],
  ["quoted parameter expansion", "VALUE='  a  *  b '; cat <<<\"$VALUE\""],
  ["arithmetic and substitution", "cat <<<\"$((2+3)):$(printf 'text\\n\\n'):`printf more`\""],
  ["parameter assignment", "cat <<<${VALUE:=first}; printf '<%s>' \"$VALUE\""],
  ["quoted positional at uses spaces", "set -- a b; IFS=:; cat <<<\"$@\""],
  ["quoted positional star uses IFS", "set -- a b; IFS=:; cat <<<\"$*\""],
  ["empty quoted positional at", "set --; cat <<<\"$@\""],
  ["quoted empty positional arguments", "set -- a '' b; IFS=; cat <<<\"$@\"; cat <<<\"$*\""],
  ["parameter alternate positional at", "set -- a b; IFS=:; cat <<<\"${MISSING:-$@}\""],
  ["unquoted positional arguments", "set -- a b; IFS=:; cat <<<$@; cat <<<$*"],
  ["tilde expansion", "HOME=/virtual/home; cat <<<~; cat <<<~/file; cat <<<'~'"],
  ["literal glob patterns", "printf file >entry; cat <<< '*'"],
  ["brace-like text is literal", "cat <<< a{b,c}d"],
  ["descriptor aliases share offsets", "{ read -r first <&3; cat <&4; printf '%s\\n' \"$first\"; } 3<<<'first\nsecond' 4<&3"],
  ["command substitution sees prior input descriptor", "cat 3<<<'shared' <<<\"$(cat <&3)\""],
  ["substitution consumes shared inherited input", "{ cat <<<\"$(read -r first <&3; printf '%s' \"$first\")\"; cat <&3; } 3<<<'first\nsecond'"],
  ["last redirection wins but all expand", "cat <<<${VALUE:=first} <<<$VALUE"],
  ["file input overrides scalar", "printf file >input; cat <<<word <input"],
  ["scalar overrides file input", "printf file >input; cat <input <<<word"],
  ["scalar overrides pipeline input", "printf unused | cat <<<word"],
  ["heredoc then here-string", "cat <<EOF <<<string\ndocument\nEOF\n"],
  ["here-string then heredoc", "cat <<<string <<EOF\ndocument\nEOF\n"],
  ["function gets fresh scalar", "func() { cat; } <<<\"$VALUE\"; VALUE=one; func; VALUE=two; func"],
  ["loop gets fresh scalar", "for VALUE in one two; do cat <<<\"$VALUE\"; done"],
  ["while reads a shared scalar", "while read -r VALUE; do printf '%s\\n' \"$VALUE\"; done <<<'one\ntwo'"],
  ["skipped expansions have no effects", "false && cat <<<\"$(printf bad >marker)\"; if false; then cat <<<${VALUE:=bad}; fi; printf '<%s>' \"$VALUE\""],
  ["read receives an empty terminal line", "read -r VALUE <<<''; printf '%s:<%s>' \"$?\" \"$VALUE\""],
  ["operator continuation", "cat <\\\n<<'word'"],
];

for (const [name, script] of cases) {
  test(`here-string Bash differential: ${name}`, async () => {
    const fixture = { name, script };
    assert.deepEqual(await runVirtualScript(fixture), await runBash(fixture));
  });
}

for (const [source, expected] of [
  ["VALUE='  a  b *\n'; pass <<<$VALUE", "  a  b *\n\n"],
  ["IFS=:; VALUE='a::b'; pass <<<$VALUE", "a::b\n"],
  ["pass <<<$(say ' a  b * ')", " a  b * \n"],
  ["pass <<<${MISSING:- a  b * }", " a  b * \n"],
  ["set -- a '' b; IFS=; pass <<<$@; pass <<<$*", "a  b\na  b\n"],
] as const) {
  test(`modern here-string scalar does not split or glob: ${source}`, async () => {
    const { shell, fs } = setup();
    await fs.writeFile("/entry", new Uint8Array());
    const result = await shell.exec(source, { signal: AbortSignal.timeout(2000) });
    assert.equal(result.stdout, expected);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const [source, status] of [
  ["say ran >marker; pass <<<", 2],
  ["say ran >marker; pass <<< >out", 2],
  ["say ran >marker; false && pass <<<$(true |)", 127],
  ["say ran >marker; pass <<<${bad", 2],
  ["say ran >marker; pass 256<<<word", 2],
] as const) {
  test(`malformed here-string rejects before effects: ${source}`, async () => {
    const { shell, fs } = setup();
    const result = await shell.exec(source);
    assert.equal(result.exitCode, status);
    assert.equal(result.stdout, "");
    assert.deepEqual(await fs.readdir("/"), []);
  });
}

test("here-string budgets include its appended newline and nested work", async () => {
  for (const [source, limits, limit] of [
    ["pass <<<word", { maxSourceBytes: 4 }, "maxSourceBytes"],
    ["pass <<<1234", { maxExpansionBytes: 4 }, "maxExpansionBytes"],
    ["pass <<<''", { maxExpansionBytes: 0 }, "maxExpansionBytes"],
    ["pass <<<''", { maxExpansionFields: 0 }, "maxExpansionFields"],
    ["pass <<<$(say word)", { maxSubstitutionDepth: 0 }, "maxSubstitutionDepth"],
    ["pass <<<$(say word)", { maxCommands: 1 }, "maxCommands"],
    ["pass <<<1234", { maxOutputBytes: 4 }, "maxOutputBytes"],
  ] as const) {
    const { shell } = setup();
    await assert.rejects(shell.exec(source, { limits, signal: AbortSignal.timeout(2000) }),
      (error) => error instanceof ShellLimitError && error.limit === limit);
  }
  const { shell } = setup();
  assert.equal((await shell.exec("pass <<<1234", { limits: { maxExpansionBytes: 5 } })).stdout, "1234\n");
});

test("here-string substitutions retain the UTF-8 and NUL string boundary", async () => {
  const { shell } = setup();
  const result = await shell.exec("pass <<<$(bytes)");
  assert.deepEqual(result.stdoutBytes, new TextEncoder().encode("�é�\n"));
});

test("here-string cancellation observes late host rejection", { timeout: 2000 }, async () => {
  const { shell } = setup();
  const controller = new AbortController();
  const reason = new Error("cancel here-string");
  let rejectHost!: (error: Error) => void;
  shell.register({ name: "blocked", execute() {
    controller.abort(reason);
    return new Promise((_resolve, reject) => { rejectHost = reject; });
  } });
  await assert.rejects(shell.exec("pass <<<$(blocked)", { signal: controller.signal }), (error) => error === reason);
  rejectHost(new Error("late host rejection"));
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test("here-string redirection expansion errors preserve ordinary fatal-expansion scope", async () => {
  for (const expansion of ["${VALUE:?stop}", "$((1/0))"]) {
    const { shell, fs } = setup();
    const result = await shell.exec(`pass 2>errors <<<"${expansion}"; status=$?; say after >marker; exit "$status"`);
    assert.equal(result.exitCode, expansion.startsWith("${") ? 127 : 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    assert.deepEqual((await fs.readdir("/")).map((entry) => entry.name).sort(), ["errors", "marker"]);
  }
});
