import assert from "node:assert/strict";
import test from "node:test";
import { archiveCommands } from "../../../src/index.js";
import { archive, fixture, member } from "./helpers.js";

test("aggregate default tar runs, rejects accidental reinstallation, and receives archive limits", async () => {
  const bytes = archive(member("first"), member("second"));
  const { shell } = await fixture();
  try {
    const initial = await shell.exec("tar tf -", { stdin: bytes });
    assert.equal(initial.exitCode, 0, initial.stderr);
    assert.equal(initial.stdout, "first\nsecond\n");
    const registered = shell.commands.get("tar");
    assert.ok(registered);
    shell.use(archiveCommands());
    await assert.rejects(shell.exec("tar tf -", { stdin: bytes }), /Command already registered: tar/u);
    assert.equal(shell.commands.get("tar"), registered);
  } finally { await shell.dispose(); }

  const configured = await fixture({ limits: { maxMembers: 1 } });
  try {
    const result = await configured.shell.exec("tar tf -", { stdin: bytes });
    assert.equal(result.exitCode, 2, result.stderr);
    assert.match(result.stderr, /member.*limit|limit.*member/iu);
  } finally { await configured.shell.dispose(); }
});
