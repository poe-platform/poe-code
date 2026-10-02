import assert from "node:assert/strict";
import { test } from "node:test";
import { createJqCommand, createJqCommands, jqCommands } from "safe-bash-command-jq";
import * as publicJq from "../../src/commands/jq/index.js";
import { jqCommand } from "../../src/commands/structured/jq.js";
import { createStructuredCommands, structuredCommands } from "../../src/commands/structured/index.js";
import { builtInDirectContextExecutors } from "safe-bash-io-engine/internal";

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
