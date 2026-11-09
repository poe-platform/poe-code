import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";
import { standardCommands } from "../../src/commands/index.js";

const cases: [string, string][] = [
  ['set -- "a b" "" c; args "${#@}" "${#*}"', '["3","3"]'],
  ['set --; args "${#@}" "${#*}"', '["0","0"]'],
  ['set -- "a b" "c d"; args "${@:-fallback}" "${@-fallback}"', '["a b","c d","a b","c d"]'],
  ['set -- "" "c d"; args "${@:-fallback}"', '["","c d"]'],
  ['set -- ""; args "${@:-fallback}" "${@-fallback}"', '["fallback",""]'],
  ['set --; args "${@:-fallback}" "${@-fallback}"', '["fallback","fallback"]'],
  ['set -- "a b" "c d"; args "pre${@:-fallback}post"', '["prea b","c dpost"]'],
  ['set -- pre_one.txt pre_two.txt; args "${@#pre_}" "${@%.txt}" "${@/pre_/NEW_}" "${@//_/ }" "${*#pre_}"', '["one.txt","two.txt","pre_one","pre_two","NEW_one.txt","NEW_two.txt","pre one.txt","pre two.txt","one.txt two.txt"]'],
  ['set --; args "${@#pre_}"', '[]'],
  ['args "${#DIRSTACK[@]}" "${DIRSTACK[0]}"', '["1","/"]'],
  ['pushd /one >/dev/null; pushd /two >/dev/null; args "${DIRSTACK[@]}" "${#DIRSTACK[@]}"; popd >/dev/null; args "${DIRSTACK[@]}"; dirs -c; args "${DIRSTACK[@]}"', '["/two","/one","/","3"]["/one","/"]["/one"]'],
  ['pushd /one >/dev/null; cd /two; args "${DIRSTACK[@]}"', '["/two","/"]'],
  ['umask 027; umask 1000; args "$?"; umask', '["1"]0027\n'],
  ['umask 0777; umask', '0777\n'],
];

for (const [source, stdout] of cases) {
  test(`positional, stack and mask compatibility: ${source}`, async context => {
    const { shell, fs } = setup({ cwd: "/" });
    context.after(() => shell.dispose());
    await fs.mkdir("/one");
    await fs.mkdir("/two");
    const result = await shell.exec(source);
    assert.equal(result.stdout, stdout);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, source.includes("umask 1000") ? "umask: 1000: octal number out of range\n" : "");
  });
}

for (const [assignment, destination] of [
  [":", "one"],
  ['DIRSTACK[1]="$HOME/three"', "three"],
  ['DIRSTACK[-2]="$HOME/three"', "three"],
  ['i=0; DIRSTACK[++i]="$HOME/three"', "three"],
  ['DIRSTACK[1]="$HOME/th"; DIRSTACK[1]+=ree', "three"],
  ['for i in 1 2; do DIRSTACK[1]="$HOME/three"; done', "three"],
  [': "${DIRSTACK[@]}"; DIRSTACK[1]="$HOME/three"; : "${DIRSTACK[@]}"', "three"],
  ['(DIRSTACK[1]="$HOME/three")', "one"],
  ['DIRSTACK[0]="$HOME/three"', "one"],
  ['DIRSTACK[3]="$HOME/three"', "one"],
] as const) {
  test(`directory stack element assignment: ${assignment}`, async context => {
    const { shell, fs } = setup({ cwd: "/work", env: { HOME: "/work", LC_ALL: "C" }, extensions: [arraysExtension()] });
    shell.use(standardCommands());
    context.after(() => shell.dispose());
    await fs.mkdir("/work");
    for (const name of ["one", "two", "three"]) await fs.mkdir(`/work/${name}`);
    const result = await shell.exec(`
      pushd one >/dev/null; pushd ../two >/dev/null
      ${assignment}; echo "write=$?"
      dirs -l -p
      popd >/dev/null; echo "\${PWD##*/}"
      dirs -l -p
      popd >/dev/null; echo "$PWD"
    `);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, `write=0\n/work/two\n/work/${destination}\n/work\n${destination}\n/work/${destination}\n/work\n/work\n`);
  });
}

test("directory stack element assignments preserve byte limits and the stack on rejection", async context => {
  const { shell } = setup({ cwd: "/", extensions: [arraysExtension()] });
  context.after(() => shell.dispose());
  const result = await shell.exec('pushd -n abc >/dev/null; DIRSTACK[1]=longer; say "$?"; dirs -l -p; DIRSTACK[1]=é; pushd -n x; dirs -l -p', { limits: { maxDirectoryStackBytes: 3 } });
  assert.equal(result.exitCode, 0);
  assert.match(result.stderr, /directory stack byte limit exceeded/);
  assert.equal(result.stdout, "1\n/\nabc\n/ x é\n/\nx\né\n");
});
