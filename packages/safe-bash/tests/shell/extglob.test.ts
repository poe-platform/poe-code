import assert from "node:assert/strict";
import test from "node:test";
import { setup } from "./helpers.js";
import { standardCommands } from "../../src/index.js";

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
printf 'disabled:%s\\n' @(a|b).txt
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
