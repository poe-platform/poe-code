import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { parseShell } from "../../src/shell/parser.js";
import { standardCommands } from "../../src/index.js";

for (const operator of ["@", "?", "*", "+", "!"]) {
  for (const word of [`${operator}$pat`, "$op$pat"]) {
    test(`extglob operator spans word parts: ${operator}, ${word}`, async () => {
      const { shell, fs } = setup({ cwd: "/work" });
      await fs.mkdir("/work");
      await fs.writeFile("/work/foo.txt", new Uint8Array());
      await fs.writeFile("/work/other.txt", new Uint8Array());
      try {
        const result = await shell.exec(`shopt -s extglob; op='${operator}'; pat='(foo.txt|bar.txt)'; args ${word}`);
        assert.equal(result.stdout, JSON.stringify([operator === "!" ? "other.txt" : "foo.txt"]));
        assert.equal(result.stderr, "");
        assert.equal(result.exitCode, 0);
      } finally {
        await shell.dispose();
      }
    });
  }
}

for (const [options, word, expected] of [
  ["shopt -s extglob", '@"$pat"', "@(foo.txt|bar.txt)"],
  ["shopt -s extglob", '"@"$pat', "@(foo.txt|bar.txt)"],
  ["shopt -u extglob", "@$pat", "@(foo.txt|bar.txt)"],
  ["shopt -s extglob; set -f", "@$pat", "@(foo.txt|bar.txt)"],
] as const) {
  test(`split extglob respects quoting and options: ${options}, ${word}`, async () => {
    const { shell, fs } = setup();
    await fs.writeFile("/foo.txt", new Uint8Array());
    try {
      const result = await shell.exec(`${options}; pat='(foo.txt|bar.txt)'; args ${word}`);
      assert.equal(result.stdout, JSON.stringify([expected]));
      assert.equal(result.stderr, "");
      assert.equal(result.exitCode, 0);
    } finally {
      await shell.dispose();
    }
  });
}

test("shopt -s extglob pathname expansion: @(a|b), ?(pat), *(pat), +(pat), !(pat)", async () => {
  const { shell, fs } = setup();
  shell.use(standardCommands());
  await fs.writeFile("/a.txt", new Uint8Array());
  await fs.writeFile("/b.txt", new Uint8Array());
  await fs.writeFile("/c.txt", new Uint8Array());
  await fs.writeFile("/ab.txt", new Uint8Array());
  await fs.writeFile("/aab.txt", new Uint8Array());
  await fs.writeFile("/.hidden.txt", new Uint8Array());

  try {
    const atResult = await shell.exec("shopt -s extglob\nprintf '<%s>\\n' @(a|b).txt");
    assert.equal(atResult.stderr, "");
    assert.equal(atResult.exitCode, 0);
    assert.equal(atResult.stdout, "<a.txt>\n<b.txt>\n");

    const plusResult = await shell.exec("shopt -s extglob\nprintf '<%s>\\n' +(a)b.txt");
    assert.equal(plusResult.stderr, "");
    assert.equal(plusResult.exitCode, 0);
    assert.equal(plusResult.stdout, "<aab.txt>\n<ab.txt>\n");

    const starResult = await shell.exec("shopt -s extglob\nprintf '<%s>\\n' *(a)b.txt");
    assert.equal(starResult.stderr, "");
    assert.equal(starResult.exitCode, 0);
    assert.equal(starResult.stdout, "<aab.txt>\n<ab.txt>\n<b.txt>\n");

    const qResult = await shell.exec("shopt -s extglob\nprintf '<%s>\\n' ?(a)b.txt");
    assert.equal(qResult.stderr, "");
    assert.equal(qResult.exitCode, 0);
    assert.equal(qResult.stdout, "<ab.txt>\n<b.txt>\n");

    const notResult = await shell.exec("shopt -s extglob\nprintf '<%s>\\n' !(a|b|ab|aab).txt");
    assert.equal(notResult.stderr, "");
    assert.equal(notResult.exitCode, 0);
    assert.equal(notResult.stdout, "<c.txt>\n");
  } finally {
    await shell.dispose();
  }
});

test("shopt -s extglob case statement matching and nested extglobs", async () => {
  const { shell } = setup();
  shell.use(standardCommands());
  try {
    const script = `
shopt -s extglob
for item in foo.ts bar.js baz.py qux.tsx README.md; do
  case "$item" in
    @(*.ts|*.tsx)) printf 'ts:%s\\n' "$item" ;;
    !(*.md)) printf 'code:%s\\n' "$item" ;;
    *) printf 'doc:%s\\n' "$item" ;;
  esac
done
`;
    const result = await shell.exec(script);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout,
      "ts:foo.ts\ncode:bar.js\ncode:baz.py\nts:qux.tsx\ndoc:README.md\n"
    );
  } finally {
    await shell.dispose();
  }
});

test("conditional [[ == ]] and [[ != ]] with extglob patterns", async () => {
  const { shell } = setup();
  shell.use(standardCommands());
  try {
    const result = await shell.exec(`
[[ "ab" == @(ab|cd) ]] && printf '1:%s\\n' "$?"
[[ "ef" != @(ab|cd) ]] && printf '2:%s\\n' "$?"
[[ "aaab" == +(a)b ]] && printf '3:%s\\n' "$?"
[[ "xyz" == !(ab|cd) ]] && printf '4:%s\\n' "$?"
[[ "@(ab|cd)" == "@(ab|cd)" ]] && printf '5:%s\\n' "$?"
[[ "ab" == "@(ab|cd)" ]] || printf '6:literal\\n'
`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "1:0\n2:0\n3:0\n4:0\n5:0\n6:literal\n");
  } finally {
    await shell.dispose();
  }
});

test("parameter expansion trimming (#, ##, %, %%) and substitution (/, //) with extglob", async () => {
  const { shell } = setup();
  shell.use(standardCommands());
  try {
    const result = await shell.exec(`
shopt -s extglob
v="   hello   "
printf 'ltrim:<%s>\\n' "\${v##+( )}"
printf 'rtrim:<%s>\\n' "\${v%%+( )}"
p="src/components/Button.tsx"
printf 'base:<%s>\\n' "\${p##*/}"
printf 'stem:<%s>\\n' "\${p%.@(ts|tsx|js|jsx)}"
s="foo123bar456baz"
printf 'sub1:<%s>\\n' "\${s/+([0-9])/NUM}"
printf 'suball:<%s>\\n' "\${s//+([0-9])/NUM}"
`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout,
      "ltrim:<hello   >\nrtrim:<   hello>\nbase:<Button.tsx>\nstem:<src/components/Button>\nsub1:<fooNUMbar456baz>\nsuball:<fooNUMbarNUMbaz>\n"
    );
  } finally {
    await shell.dispose();
  }
});

test("case fallthrough (;;&, ;&), heredocs (<<), here-strings (<<<), and shopt -u extglob toggle", async () => {
  const { shell, fs } = setup();
  shell.use(standardCommands());
  await fs.writeFile("/a.txt", new Uint8Array());
  await fs.writeFile("/b.txt", new Uint8Array());
  try {
    const result = await shell.exec(`
shopt -s extglob
val="   trimmed_line   "
cat <<< "\${val##+( )}" | tr -d ' '
cat <<EOF
heredoc:\${val%%+( )}
EOF
case "alpha123" in
  +([a-z])+([0-9])) printf 'alnum\\n' ;;&
  @(alpha*|beta*)) printf 'prefix\\n' ;&
  never_matches) printf 'fallthrough\\n' ;;
esac
shopt -u extglob
printf 'disabled:%s\\n' '@(a|b).txt'
`);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
    assert.equal(
      result.stdout,
      "trimmed_line\nheredoc:   trimmed_line\nalnum\nprefix\nfallthrough\ndisabled:@(a|b).txt\n"
    );
  } finally {
    await shell.dispose();
  }
});

// Expected outputs verified against GNU Bash 5.3.20.
for (const [pattern, value, stdout] of [
  ["*(a)", "aba", "XXbX\n"],
  ["*(a)", "abba", "XXbXbX\n"],
  ["*(a)", "baa", "XbX\n"],
  ["*(a)", "aab", "XXb\n"],
  ["*(a)", "bb", "XbXb\n"],
  ["*(a)", "", "X\n"],
  ["*(a)", "a", "X\n"],
  ["*(a)", "aéb", "XXéXb\n"],
  ["?(a)", "aba", "XXbX\n"],
  ["?(a)", "abba", "XXbXbX\n"],
  ["?(a)", "baa", "XbXX\n"],
  ["?(a)", "aab", "XXXb\n"],
  ["?(a)", "bb", "XbXb\n"],
  ["?(a)", "", "\n"],
  ["?(a)", "a", "X\n"],
  ["?(a)", "aéb", "XXéXb\n"],
  ["!(b)", "aba", "X\n"],
  ["!(b)", "abba", "X\n"],
  ["!(b)", "baa", "X\n"],
  ["!(b)", "aab", "X\n"],
  ["!(b)", "bb", "X\n"],
  ["!(b)", "", "\n"],
  ["!(b)", "a", "X\n"],
  ["!(b)", "aéb", "X\n"],
] as const) {
  test(`empty extglob replacement boundaries: ${pattern}, ${value}`, async () => {
    const { shell } = setup();
    shell.use(standardCommands());
    try {
      const actual = await shell.exec(`shopt -s extglob\nx='${value}'; echo "\${x//${pattern}/X}"`);
      assert.equal(actual.exitCode, 0);
      assert.equal(actual.stderr, "");
      assert.equal(actual.stdout, stdout);
    } finally { await shell.dispose(); }
  });
}

for (const [source, exitCode, stdout] of [
  ["echo !(foo)", 2, ""],
  ["shopt -s extglob; echo @(a|b)", 2, ""],
  ["shopt -s extglob\necho @(a|b)", 0, "@(a|b)\n"],
  ["shopt -s extglob\nshopt -u extglob; echo @(a|b)", 0, "@(a|b)\n"],
  ["shopt -s extglob\nshopt -u extglob\necho @(a|b)", 2, ""],
  ["{ shopt -s extglob; echo @(a|b); }", 2, ""],
  ["f() { shopt -s extglob; echo @(a|b); }; f", 2, ""],
  ["echo '@(a|b)'", 0, "@(a|b)\n"],
  ["echo \"@(a|b)\"", 0, "@(a|b)\n"],
  ["[[ a == @(a|b) ]] && echo yes", 0, "yes\n"],
  ["shopt -s extglob; eval 'echo @(a|b)'", 0, "@(a|b)\n"],
  ["shopt -s extglob\necho $(echo @(a|b))", 0, "@(a|b)\n"],
  ["echo $(echo @(a|b))", 127, ""],
  ["shopt -s extglob\ncase a in @(a|b)) echo yes;; esac", 0, "yes\n"],
  ["case a in @(a|b)) echo yes;; esac", 2, ""],
] as const) {
  test(`parse-time extglob option: ${JSON.stringify(source)}`, async () => {
    const { shell } = setup();
    shell.use(standardCommands());
    try {
      const actual = await shell.exec(source);
      assert.equal(actual.exitCode, exitCode);
      assert.equal(actual.stdout, stdout);
      if (exitCode !== 0) assert.match(actual.stderr, /(?:syntax error|Expected command separator|Expected case pattern)/u);
      else assert.equal(actual.stderr, "");
    } finally { await shell.dispose(); }
  });
}

test("parseShell exposes the parse-time extglob option", () => {
  assert.throws(() => parseShell("echo @(a|b)"), /syntax error/u);
  assert.doesNotThrow(() => parseShell("echo @(a|b)", 0, { extglob: true }));
});

test("cached input units respect extglob changes between invocations", async () => {
  const { shell } = setup();
  shell.use(standardCommands());
  const source = 'shopt "$mode" extglob\necho @(a|b)';
  try {
    for (const mode of ["-s", "-u", "-s", "-u"]) {
      const actual = await shell.exec(source, { env: { mode } });
      assert.equal(actual.exitCode, mode === "-s" ? 0 : 2);
      assert.equal(actual.stdout, mode === "-s" ? "@(a|b)\n" : "");
    }
  } finally { await shell.dispose(); }
});

test("eval caches respect extglob changes within an invocation", async () => {
  const { shell } = setup();
  shell.use(standardCommands());
  try {
    const actual = await shell.exec(`for mode in -s -u -s; do
  shopt "$mode" extglob
  eval 'echo @(a|b)'
  echo "$?"
done`);
    assert.equal(actual.exitCode, 0);
    assert.equal(actual.stdout, "@(a|b)\n0\n2\n@(a|b)\n0\n");
    assert.match(actual.stderr, /syntax error/u);
  } finally { await shell.dispose(); }
});

for (const command of ["source /script", "bash /script", "bash"]) {
  for (const enabled of [true, false]) {
    test(`extglob parsing through ${command}, enabled=${enabled}`, async () => {
      const { shell, fs } = setup();
      shell.use(standardCommands());
      const source = `shopt ${enabled ? "-s" : "-u"} extglob\necho @(a|b)\n`;
      await fs.writeFile("/script", new TextEncoder().encode(source));
      try {
        const actual = await shell.exec(command, { stdin: source });
        assert.equal(actual.exitCode, enabled ? 0 : 2);
        assert.equal(actual.stdout, enabled ? "@(a|b)\n" : "");
      } finally { await shell.dispose(); }
    });
  }
}

for (const source of [
  "shopt -s extglob\ncat <<EOF\n$(echo @(a|b))\nEOF",
  "shopt -s extglob\nshopt -s expand_aliases\nalias pat='echo @(a|b)'\npat",
  "shopt -s extglob\necho `echo @(a|b)`",
]) {
  test(`extglob propagates to nested lexical contexts: ${JSON.stringify(source)}`, async () => {
    const { shell } = setup();
    shell.use(standardCommands());
    try {
      const actual = await shell.exec(source);
      assert.equal(actual.exitCode, 0);
      assert.equal(actual.stderr, "");
      assert.equal(actual.stdout, "@(a|b)\n");
    } finally { await shell.dispose(); }
  });
}

for (const operator of ["/", "//", "/#", "/%"] as const) {
  for (const pattern of ["", "*", "*(a)", "?(a)", "!(b)"]) {
    test(`empty replacement subject: ${operator}${pattern}`, async () => {
      const { shell } = setup();
      shell.use(standardCommands());
      try {
        const actual = await shell.exec(`shopt -s extglob\nx=; echo "\${x${operator}${pattern}/X}"`);
        const replaced = pattern.startsWith("*") || operator === "/%" || (operator === "/#" && pattern === "");
        assert.equal(actual.exitCode, 0);
        assert.equal(actual.stderr, "");
        assert.equal(actual.stdout, replaced ? "X\n" : "\n");
      } finally { await shell.dispose(); }
    });
  }
}

for (const [source, stdout] of [
  ['shopt -s extglob\na[$(echo @(anything) >/dev/null; echo 0)]=v; echo "${a[0]}"', "v\n"],
  ['shopt -s extglob\necho $(( $(echo @(anything) >/dev/null; echo 3) ))', "3\n"],
] as const) {
  test(`enabled extglob inside arithmetic and subscripts: ${JSON.stringify(source)}`, async () => {
    const { shell } = setup();
    shell.use(standardCommands());
    try {
      const actual = await shell.exec(source);
      assert.equal(actual.exitCode, 0, actual.stderr);
      assert.equal(actual.stdout, stdout);
      assert.equal(actual.stderr, "");
    } finally { await shell.dispose(); }
  });
}
