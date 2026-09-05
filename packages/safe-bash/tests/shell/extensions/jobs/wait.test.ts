import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "poe-code/safe-fs";
import { Shell } from "../../../../src/shell/shell.js";
import { browserCommands } from "../../../../src/browser.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { primaryJobReference } from "./primary53-reference.js";

for (const id of [1, 2, 3, 4, 5, 7, 8, 9, 14]) {
  const reference = primaryJobReference(id);
  test(`primary Bash 5.3 ordinary jobs ${id}: ${reference.name}`, async context => {
    assert.equal(reference.requiresController, false);
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()], env: { LC_ALL: "C" } }).use(browserCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(reference.source, { stdin: reference.stdin });
    assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
    assert.equal(result.exitCode, reference.status);
  });
}
