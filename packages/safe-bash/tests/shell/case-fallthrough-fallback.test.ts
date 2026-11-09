import assert from "node:assert/strict";
import { test } from "node:test";
import { standardCommands } from "../../src/commands/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { trapExtension } from "../../src/shell/extensions/trap/index.js";
import { Shell } from "../../src/shell/index.js";

for (const terminator of [";&", ";;&"]) {
  test(`case ${terminator} never replays output or mutations on fallback`, async context => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`cnt=0; case foo in foo) cnt=$((cnt+1)); echo "clause1:$cnt" ${terminator} foo|bar) if [ -e /dev/null ]; then cnt=$((cnt+10)); echo "clause2:$cnt"; fi ;; esac; echo "final:$cnt"`);
    assert.equal(result.stdout, "clause1:1\nclause2:11\nfinal:11\n");
    assert.equal(result.exitCode, 0);
  });
}

for (const extensions of [false, true]) {
  for (const [values, pattern, subjects, expected] of [
    ["png jpg", '"$@"', ["png", "png jpg", "jpg"], "matched\nmissed\nmissed\n"],
    ["png jpg", '"${names[@]}"', ["png", "png jpg", "jpg"], "matched\nmissed\nmissed\n"],
    ["png", '"$@"', ["png"], "matched\n"],
    ["png", '"${names[@]}"', ["png"], "matched\n"],
    ["png jpg", '"$1"', ["png"], "matched\n"],
    ["png jpg", '"$*"', ["png jpg", "png"], "matched\nmissed\n"],
    ["png jpg", '"${names[*]}"', ["png jpg", "png"], "matched\nmissed\n"],
    ["'' jpg", '"$@"', ["", "jpg"], "matched\nmissed\n"],
    ["'' jpg", '"${names[@]}"', ["", "jpg"], "matched\nmissed\n"],
    ["'p*' jpg", '"$@"', ["p*", "png"], "matched\nmissed\n"],
    ["'p*' jpg", '"${names[@]}"', ["p*", "png"], "matched\nmissed\n"],
  ] as const) {
    test(`case pattern ${pattern} with ${values}, extensions=${extensions}`, async context => {
      const shell = new Shell({ fs: new MemoryFileSystem(), env: { LC_ALL: "C" }, extensions: extensions ? [trapExtension()] : [] }).use(standardCommands());
      context.after(() => shell.dispose());
      const source = `set -- ${values}; names=("$@"); ` + subjects.map(subject =>
        `case '${subject}' in ${pattern}) echo matched;; *) echo missed;; esac`
      ).join("; ");
      const result = await shell.exec(source);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, expected);
    });
  }
}
