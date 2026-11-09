import assert from "node:assert/strict";
import { test } from "node:test";
import { Shell } from "../../src/shell/index.js";
import { MemoryFileSystem } from "../../src/fs/memory/index.js";
import { standardCommands } from "../../src/commands/index.js";

for (const [name, source, stdout] of [
  ["exposes caller and preserves writes", 'x=old; f() { unset x; echo "${x-missing}"; x=changed; }; x=temp f; echo "$x"', "old\nchanged\n"],
  ["without an outer binding", 'unset x; f() { unset x; echo "${x-missing}"; }; x=temp f; echo "${x-missing}"', "missing\nmissing\n"],
  ["writes a previously absent outer binding", 'unset x; f() { unset x; x=changed; }; x=temp f; echo "$x"', "changed\n"],
  ["without unset remains temporary", 'x=old; f() { echo "$x"; x=changed; }; x=temp f; echo "$x"', "temp\nold\n"],
  ["exposes caller local", 'x=old; g() { unset x; echo "$x"; x=changed; }; f() { local x=local; x=temp g; echo "$x"; }; f; echo "$x"', "local\nchanged\nold\n"],
  ["nested prefix exposes enclosing prefix", 'x=old; g() { unset x; echo "$x"; x=changed; }; f() { x=inner g; echo "$x"; }; x=temp f; echo "$x"', "temp\nchanged\nold\n"],
  ["local unset keeps its shadow", 'x=old; f() { local x=local; unset x; echo "${x-missing}"; x=changed; }; x=temp f; echo "$x"', "missing\nold\n"],
  ["caller local redeclaration shares the prefix scope", 'x=old; f() { local x=inner; g; echo "${x-missing}"; }; g() { unset x; echo "${x-missing}"; x=changed; }; x=temp f; echo "$x"', "old\nchanged\nchanged\n"],
  ["subshell stays isolated", 'x=old; f() { (unset x; echo "$x"; x=changed; echo "$x"); echo "$x"; }; x=temp f; echo "$x"', "old\nchanged\ntemp\nold\n"],
  ["restores caller attributes", 'declare -i x=7; f() { unset x; x=2+3; echo "$x"; }; x=8 f; echo "$x"', "5\n5\n"],
  ["restores caller export", 'export x=old; f() { unset x; echo "${x@a}"; x=changed; }; x=temp f; echo "${x@a}:$x"', "x\nx:changed\n"],
  ["restores caller array", 'x=(old tail); f() { unset x; echo "${x[*]}"; x=changed; }; x=temp f; echo "${x[*]}"', "old tail\nchanged tail\n"],
  ["repeated unset removes the exposed binding", 'x=old; f() { unset x; unset x; echo "${x-missing}"; x=changed; }; x=temp f; echo "$x"', "missing\nchanged\n"],
  ["return keeps writes after unset", 'x=old; f() { unset x; echo "$x"; x=changed; return 3; }; x=temp f; echo "$?:$x"', "old\n3:changed\n"],
] as const) {
  test(`function prefix unset: ${name}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(source);
    assert.equal(result.stdout, stdout);
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}
