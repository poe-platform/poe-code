import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { standardCommands } from "../../src/index.js";
import { arraysExtension } from "../../src/shell/extensions/arrays/index.js";
import { Shell } from "../../src/shell/shell.js";

for (const initialize of ["a=(x)", ': "${PIPESTATUS[*]}"']) {
  test(`lastpipe completes after ${initialize}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [arraysExtension()] }).use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`shopt -s lastpipe\n${initialize}\ntrue | true`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  });
}

for (const lastpipe of [false, true]) {
  test(`pipeline array changes stay in their own stage with lastpipe=${lastpipe}`, async t => {
    const shell = new Shell({ fs: new MemoryFileSystem(), extensions: [arraysExtension()] }).use(standardCommands());
    t.after(() => shell.dispose());
    const result = await shell.exec(`shopt -${lastpipe ? "s" : "u"} lastpipe
a=(parent)
{ a[0]=first; printf '%s\\n' "${'${a[0]}'}"; } | { a[0]=middle; cat; printf '%s\\n' "${'${a[0]}'}"; } | { a[0]=last; cat; }
printf '%s\\n' "${'${a[0]}'}"
true | true`);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, `first\nmiddle\n${lastpipe ? "last" : "parent"}\n`);
    assert.equal(result.stderr, "");
  });
}
