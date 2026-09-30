import assert from "node:assert/strict";
import test from "node:test";
import { createShufCommand } from "safe-bash-command-shuf";
import { createFoldCommand } from "safe-bash-command-fold/family";
import { createStreamInspectionCommands } from "../../src/commands/stream-inspection/index.js";
import { settings } from "../../src/commands/stream-inspection/shared.js";
import { shufCommand } from "../../src/commands/shuf.js";
import { parseTomlDocument, YqLedger } from "../../src/optional-host.js";
import { parseTomlDocument as packageParser } from "safe-bash-command-yq/toml";
import { YqLedger as PackageLedger } from "safe-bash-command-yq/accounting";

test("legacy shuf entry uses the workspace factory", () => {
  assert.equal(shufCommand, createShufCommand);
});
test("optional host uses the same yq classes and parser as the command package", () => {
  assert.equal(parseTomlDocument, packageParser);
  assert.equal(YqLedger, PackageLedger);
});
test("stream fold uses the package command with its family limits", () => {
  const command = createStreamInspectionCommands().find(command => command.name === "fold")!;
  assert.equal(command.description, createFoldCommand(settings({})).description);
  assert.equal(command.runtimeIdentity, createFoldCommand(settings({})).runtimeIdentity);
});

 test("default and optional shuf produce the same deterministic output", async () => {
  const { Shell, agentCommands, createMemoryFileSystem } = await import("../../src/index.js");
  const { shufCommands } = await import("../../src/optional.js");
  const fs = createMemoryFileSystem();
  await fs.mkdir("/dev");
  await fs.writeFile("/dev/zero", new Uint8Array(4096));
  const standard = new Shell({ fs }).use(agentCommands());
  const optional = new Shell({ fs }).use(shufCommands());
  try {
    const source = "shuf --random-source=/dev/zero -n 2 -e alpha beta gamma";
    const first = await standard.exec(source);
    const second = await optional.exec(source);
    assert.equal(first.exitCode, 0);
    assert.equal(first.stderr, "");
    assert.equal(second.exitCode, 0);
    assert.equal(first.stdout, second.stdout);
  } finally {
    await standard.dispose();
    await optional.dispose();
  }
});
