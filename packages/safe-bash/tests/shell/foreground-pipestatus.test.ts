import assert from "node:assert/strict";
import { test } from "node:test";
import { agentCommands } from "../../src/plugins/index.js";
import { setup } from "./helpers.js";

for (const limits of [undefined, { maxExpansionBytes: 1048576, maxExpansionFields: 1024 }]) {
  test(`foreground commands replace PIPESTATUS (${limits ? "async" : "sync"})`, async context => {
    const { shell } = setup({ cwd: "/work", ...(limits ? { limits } : {}) });
    shell.use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec('true | false | (exit 7); echo "${PIPESTATUS[@]}"; echo "${PIPESTATUS[@]}"; (exit 3); echo "${PIPESTATUS[@]}"; :; echo "${PIPESTATUS[@]}"');
    assert.equal(result.stdout, "0 1 7\n0\n3\n0\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });

  test(`printf replaces materialized PIPESTATUS (${limits ? "async" : "sync"})`, async context => {
    const { shell } = setup(limits ? { limits } : {});
    shell.use(agentCommands());
    context.after(() => shell.dispose());
    const result = await shell.exec('true | false; printf "%s\\n" "${PIPESTATUS[@]}"; printf "%s\\n" "${PIPESTATUS[@]}"');
    assert.equal(result.stdout, "0\n1\n0\n");
    assert.equal(result.stderr, "");
    assert.equal(result.exitCode, 0);
  });
}
