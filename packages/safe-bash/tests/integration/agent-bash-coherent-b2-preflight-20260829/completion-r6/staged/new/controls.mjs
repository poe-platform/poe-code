import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { supervisor } from "./owner.mjs";
import { caps, grant, ledger, rows } from "./support.mjs";
import { classifyTypes, classifyMutant, classifyCases } from "./classify.mjs";

export async function runControls({ work, recipe }) {
  const root = path.join(work, "harmless-controls"); fs.mkdirSync(root, { mode: 0o700 });
  const files = ledger([root], Date.now() + 60000);
  const roles = ["type-valid", "type-wrong", "mutant", "restore"];
  const expectedExitCodes = { "type-valid": [2], "type-wrong": [2], mutant: [1], restore: [0] };
  const manager = supervisor(root, 60, 1048576, { roles, allowedExitCodes: expectedExitCodes, io: files.io, observe: () => files.observe(), started: performance.now() });
  const filename = path.join(root, "consumer-negative.mts");
  const mutation = recipe.mutations[0];
  const specification = { filename, diagnostics: recipe.expectedDiagnostics, case: { id: mutation.case, pass: false, error: recipe.mutantFailures[mutation.id], created: 1, disposed: 1 } };
  const specificationPath = path.join(root, "fixture.json"); files.write(specificationPath, JSON.stringify(specification));
  const outcomes = [];
  try {
    for (const role of roles) {
      const result = await manager.run(role, process.execPath, [new URL("./fixture.mjs", import.meta.url).pathname, role, specificationPath], { cwd: root, env: { HOME: root, TMPDIR: root, TMP: root, TEMP: root, NODE_OPTIONS: "", NODE_PATH: "", PATH: path.dirname(process.execPath) }, seconds: 5 });
      const text = fs.readFileSync(result.stdout, "utf8");
      if (role === "type-valid") outcomes.push(classifyTypes(result, text, filename, recipe.expectedDiagnostics, true));
      if (role === "type-wrong") { assert.throws(() => classifyTypes(result, text, filename, recipe.expectedDiagnostics, true)); outcomes.push({ rejectedWrongDiagnostic: true }); }
      if (role === "mutant") {
        const trace = [{ kind: "authenticated-source-supplied", member: `dist/${mutation.file}`, sha256: mutation.prospectiveMutantSha256 }];
        outcomes.push(classifyMutant(result, rows(text), trace, mutation, recipe.mutantFailures[mutation.id]));
        assert.throws(() => classifyMutant(result, rows(text), [], mutation, recipe.mutantFailures[mutation.id]));
        assert.throws(() => classifyMutant({ ...result, signalCount: 1 }, rows(text), trace, mutation, recipe.mutantFailures[mutation.id]));
      }
      if (role === "restore") outcomes.push(classifyCases(result, rows(text), [mutation.case]));
    }
    const now = Date.now();
    const valid = { schema: "B2_RUNTIME_GO_R6", authority: "ROOT_B2_672_EXPLICIT_FRESH_GO", reviewAuthority: "INDEPENDENT_PREEXEC_REVIEW_ACCEPTED", reviewCommit: "a".repeat(40), packetSha256: "b".repeat(64), caps, workRoot: "/private/tmp/safe-bash-b2-runtime-r6", issuedAt: new Date(now - 1000).toISOString(), notBefore: new Date(now).toISOString(), activeDeadline: new Date(now + 1620000).toISOString(), deadline: new Date(now + 1800000).toISOString() };
    grant(valid, now);
    assert.throws(() => grant({ ...valid, caps: { ...caps, seconds: Infinity } }, now));
    assert.throws(() => grant({ ...valid, activeDeadline: valid.issuedAt }, now));
    const retirement = manager.finish();
    return { status: "PURE_POLICY_CONTROLS_PASS", actualHarmlessNodeChildren: 4, outcomes, retirement, grantControls: 3, qualification: "Synthetic diagnostics and synthetic loaded-proof records only; not compiler, product, actual loader, mutant or Worker execution. No OS containment/universal census/group absence claim." };
  } catch (error) { manager.abort(error); throw error; }
}
