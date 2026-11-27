import assert from "node:assert/strict";
import { test } from "node:test";
import { createJqCommand, createJqCommands, jqCommands } from "safe-bash-command-jq";
import * as publicJq from "../../src/commands/jq/index.js";
import { jqCommand } from "../../src/commands/structured/jq.js";
import { createStructuredCommands, structuredCommands } from "../../src/commands/structured/index.js";
import { builtInDirectContextExecutors } from "safe-bash-io-engine/internal";
import { spawnSync } from "node:child_process";
import { agentCommands } from "../../src/plugins/index.js";
import { createMemoryFileSystem } from "../../src/fs/memory/index.js";
import { Shell } from "../../src/shell/index.js";

test("jq public and legacy facades share the workspace command owner", () => {
  assert.equal(publicJq.createJqCommand, createJqCommand);
  assert.equal(publicJq.createJqCommands, createJqCommands);
  assert.equal(publicJq.jqCommands, jqCommands);
  assert.equal(jqCommand, createJqCommand);
  assert.deepEqual(createStructuredCommands().map(command => command.name), ["jq"]);
  assert.deepEqual(createJqCommands().map(command => command.name), ["jq"]);
  assert.equal(structuredCommands().name, "structured-commands");
  assert.ok(builtInDirectContextExecutors.has(createJqCommand().execute));
});

for (const [input, filter] of [
  ['{"a":1,"b":2}', 'add'],
  ['{"counts":{"a":1,"b":2}}', '.counts | add'],
  ['{"a":1,"b":2}', 'map_values(. * 2) | add'],
  ['{}', 'add'],
  ['{"2":"first","1":"second"}', 'add'],
  ['{"a":[1],"b":[2,3]}', 'add'],
  ['{"a":{"x":1},"b":{"x":2,"y":3}}', 'add'],
  ['{"a":null,"b":2}', 'add'],
  ['{"a":1,"b":"x"}', 'add'],
  ['[1,2,3]', 'add'],
  ['[]', 'add'],
  ['null', 'add'],
  ['false', 'add'],
  ['1', 'add'],
  ['"abc"', 'add'],
] as const) test(`jq add matches native values and status: ${input} | ${filter}`, async () => {
  const native = spawnSync("jq", ["-c", filter], { input: `${input}\n`, encoding: "utf8" });
  assert.ifError(native.error);
  assert.equal(native.signal, null);
  const shell = new Shell({ fs: createMemoryFileSystem(), cwd: "/work" }).use(agentCommands());
  try {
    const result = await shell.exec(`echo '${input}' | jq -c '${filter}'`);
    assert.deepEqual({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }, {
      stdout: native.stdout, stderr: native.stderr, exitCode: native.status,
    });
  } finally { await shell.dispose(); }
});
