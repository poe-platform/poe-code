import assert from "node:assert/strict";
import { test } from "node:test";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";
import { setup } from "./helpers.js";

for (const ifs of [":", "", " \t\n"]) {
  test(`heredoc positional and array separators preserve config bytes with IFS=${JSON.stringify(ifs)}`, async context => {
    const { shell, fs } = setup({ extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    const result = await shell.exec(`IFS='${ifs}'
set -- 'preA B' '' 'preC D'
a=("$@")
pass >cfg <<END
args=$*
trimmed=\${a[@]#pre}
tail=\${a[@]:1}
END
pass <cfg`);
    const expected = new TextEncoder().encode(`args=preA B${ifs === ":" ? "  " : " "}preC D\ntrimmed=A B  C D\ntail= preC D\n`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/cfg"), expected);
    assert.deepEqual(result.stdoutBytes, expected);
  });

  test(`heredoc plain positional expansions retain empty fields with IFS=${JSON.stringify(ifs)}`, async context => {
    const { shell, fs } = setup();
    context.after(() => shell.dispose());
    const result = await shell.exec(`IFS='${ifs}'
set -- 'preA B' '' 'preC D'
pass >cfg <<END
args=$*
END
pass <cfg`);
    const expected = new TextEncoder().encode("args=preA B  preC D\n");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/cfg"), expected);
    assert.deepEqual(result.stdoutBytes, expected);
  });
}

test("heredoc array operations use spaces while plain star arrays use IFS", async context => {
  const { shell, fs } = setup({ extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  const result = await shell.exec(`IFS=:
set -- 'preA B' '' 'preC D'
a=("$@")
pass >cfg <<END
\${a[@]}
\${a[@]#pre}
\${a[@]% D}
\${a[@]//pre/}
\${a[@]:1}
\${@:2}
\${a[@]@Q}
\${a[*]}
END`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(await fs.readFile("/cfg"), new TextEncoder().encode("preA B  preC D\nA B  C D\npreA B  preC\nA B  C D\n preC D\n preC D\n'preA B' '' 'preC D'\npreA B::preC D\n"));
});

for (const [initial, body, expected] of [
  ["IFS=''; set -- ' A  B ' '' 'C:D'", "$*\n$@", "A B C:D\n A  B   C:D\n"],
  ["IFS=:; set -- ' A  B ' '' 'C:D'", "$@\n$*", " A  B   C:D\n A  B   C D\n"],
  ["IFS=''; set -- 'A\tB' '' C", "$*\n$@", "A\tB C\nA\tB  C\n"],
  ["unset IFS; set -- 'A\tB' '' C", "$*\n$@", "A B C\nA\tB  C\n"],
  ["IFS=''; set -- 'A:B' '' C", "$*|${IFS:=:}|$@", "A B  C|:|A:B  C\n"],
  ["IFS=''; set -- ' A  B ' '' C", "$*\n${@:99}", "A B C\n\n"],
  ["IFS=''; set -- 'A B' '' C; a=(x)", "$*|${a[@]+yes}", "A B  C|yes\n"],
  ["IFS=''; set -- 'A B' '' C; a=(x)", "$*|${a[@]:+yes}", "A B  C|yes\n"],
  ["IFS=''; set -- 'A B' '' C; a=(x)", "$*|${!a[@]}", "A B C|0\n"],
  ["IFS=''; set -- 'A B' '' C", "$*|${unset:-$@}", "A B C|A B  C\n"],
  ["IFS=''; set -- '  preA::B  ' '' ' preC:D '; empty=''", "${empty}$*${empty}$*|$@", "preA::B preC:D preA::B preC:D |  preA::B     preC:D \n"],
  ["IFS=''; set -- ' A ' ' B '; z=('')", "$*${z[@]}$*|$@", "A B A B | A   B \n"],
  ["IFS=''; set -- ' A ' ' B '; z=('')", "$*${z[@]:0}$*|$@", "A B  A B | A   B \n"],
  ["IFS=''; set -- ' A ' ' B '; z=('')", "$*${z[@]:1}$*|$@", "A B A B | A   B \n"],
] as const) {
  test(`heredoc star splitting retains protected boundaries: ${initial}; ${body}`, async context => {
    const { shell, fs } = setup({ extensions: [arraysExtension()] });
    context.after(() => shell.dispose());
    const result = await shell.exec(`${initial}\npass >cfg <<END\n${body}\nEND`);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.deepEqual(await fs.readFile("/cfg"), new TextEncoder().encode(expected));
  });
}

test("heredoc separators preserve raw array and positional bytes", async context => {
  const { shell, fs } = setup({ extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  const result = await shell.exec("IFS=:; set -- $'\\xff' '' $'\\xfe'; a=(\"$@\")\npass >cfg <<END\n$*\n${a[@]#pre}\n${a[@]:1}\nEND");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(await fs.readFile("/cfg"), Uint8Array.from([255, 32, 32, 254, 10, 255, 32, 32, 254, 10, 32, 254, 10]));
});

test("quoted delimiters and ordinary quoted expansions retain their rules", async context => {
  const { shell } = setup({ extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  const result = await shell.exec(`IFS=:
set -- 'preA B' '' 'preC D'
a=("$@")
pass <<'END'
$* \${a[@]#pre} \${a[@]:1}
END
args "$*" "\${a[@]#pre}" "\${a[@]:1}"`);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, '$* ${a[@]#pre} ${a[@]:1}\n["preA B::preC D","A B","","C D","","preC D"]');
});
