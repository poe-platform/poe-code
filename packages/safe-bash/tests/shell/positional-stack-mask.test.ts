import assert from "node:assert/strict";
import { test } from "node:test";
import { setup } from "./helpers.js";

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
