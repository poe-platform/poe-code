import assert from "node:assert/strict";
import test, { after } from "node:test";
import { VirtualSession } from "./session.js";
import { safetyProbes } from "./safety.js";

const session = new VirtualSession();
after(async () => { await session.dispose(); assert.deepEqual(session.backgroundErrors, []); });
for (const probe of safetyProbes) test(`independent text safety: ${probe.name}`, async () => {
  const result = await session.run({ fixture: { name: probe.name, tool: probe.tool, feature: "safety", args: probe.args }, probe });
  assert.equal(result.status, "completed", JSON.stringify(result));
  if (result.status === "completed") assert.equal(result.observation.exitCode, 0, Buffer.from(result.observation.stdout, "base64").toString());
});
