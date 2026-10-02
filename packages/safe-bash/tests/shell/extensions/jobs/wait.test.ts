import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryFileSystem } from "poe-code/safe-fs";
import { Shell } from "../../../../src/shell/shell.js";
import { agentCommands } from "../../../../src/index.js";
import { jobsExtension } from "../../../../src/shell/extensions/jobs/index.js";
import { primaryJobReference } from "./primary53-reference.js";

for (const notified of [false, true]) {
  test(`bare wait preserves the latest completed child only when unnotified: ${notified}`, async context => {
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()] }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(`(exit 7)& first=$!; (exit 9)& second=$!;
      while kill -0 "$first" 2>/dev/null || kill -0 "$second" 2>/dev/null; do :; done;
      ${notified ? 'wait "$second";' : ''}
      wait; printf "%s " "$?";
      wait "$first" 2>/dev/null; printf "%s " "$?";
      wait "$second" 2>/dev/null; printf "%s\\n" "$?"`);
    assert.equal(result.stdout, notified ? "0 127 127\n" : "0 127 9\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}

for (const id of [1, 2, 3, 4, 5, 7, 8, 9, 14]) {
  const reference = primaryJobReference(id);
  test(`primary Bash 5.3 ordinary jobs ${id}: ${reference.name}`, async context => {
    assert.equal(reference.requiresController, false);
    const shell = new Shell({ fs: createMemoryFileSystem(), extensions: [jobsExtension()], env: { LC_ALL: "C" } }).use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec(reference.source, { stdin: reference.stdin });
    assert.deepEqual(Buffer.from(result.stdoutBytes), reference.stdout);
    assert.deepEqual(Buffer.from(result.stderrBytes), reference.stderr);
    assert.equal(result.exitCode, reference.status);
  });
}
