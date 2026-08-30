import assert from "node:assert/strict";
import test from "node:test";
import { cases } from "./cases.js";
import { compare, type Execution } from "./model.js";
import { gnuPolicyCases, recordedDialectCase, selectOracle } from "./oracle-policy.js";

for (const name of gnuPolicyCases) test(`preserved BSD disagreement and independently pinned GNU result: ${name}`, () => {
  const recorded = recordedDialectCase(name);
  assert.equal(compare(recorded.fixture, recorded.bsd.native, recorded.gnu.native).status, "fail");
  const selected = selectOracle(recorded.fixture, recorded.bsd.native);
  assert.equal(selected.kind, "pinned-gnu-sed-4.9");
  assert.deepEqual(selected.execution, recorded.gnu.native);
  assert.throws(() => selectOracle({ ...recorded.fixture, args: ["p"] }, recorded.bsd.native), /Changed dialect fixture/u);
});

test("dialect policy is limited to two exact fixtures and cannot hide unsupported or pending behavior", () => {
  const pending: Execution = { status: "pending", durationMs: 0, reason: "not delivered" };
  assert.equal(cases.filter(fixture => selectOracle(fixture, pending).kind === "pinned-gnu-sed-4.9").length, 2);
  const fixture = cases.find(fixture => fixture.name === "sed-pattern-backreference-gap")!;
  assert.equal(selectOracle(fixture, pending).execution, pending);
  for (const name of gnuPolicyCases) {
    const recorded = recordedDialectCase(name);
    const selected = selectOracle(recorded.fixture, recorded.bsd.native);
    assert.equal(compare(recorded.fixture, selected.execution, pending).status, "pending");
    const unsupported: Execution = { status: "completed", durationMs: 0, observation: { exitCode: 2, stdout: "", stderr: Buffer.from("unsupported command").toString("base64"), files: {} } };
    assert.equal(compare(recorded.fixture, selected.execution, unsupported).status, "unsupported");
  }
});
