import assert from "node:assert/strict";
import { test } from "node:test";
import { Pattern } from "./text/regex.js";
import { ProgramError } from "./text/budget.js";
import { PublicDiagnostic } from "safe-bash-contracts/public-diagnostic";

test("query regex preserves named captures without host regex execution", async () => {
  const pattern = new Pattern("(?<part>a+)", true, false, "jq");
  const match = await pattern.find("baa", { step() {}, async checkpoint() {}, maxBufferBytes: 4096 });
  assert.equal(match?.groups[pattern.groupNames.get("part")!], "aa");
  assert.equal(match?.start, 1);
  await assert.rejects(pattern.find("baa", { step() {}, async checkpoint() {}, maxBufferBytes: 1 }), ProgramError);
});

test("regex errors retain the canonical public diagnostic constructor", () => {
  assert.ok(new ProgramError("bounded") instanceof PublicDiagnostic);
  assert.throws(() => new Pattern("[", true, false, "jq"), ProgramError);
});
