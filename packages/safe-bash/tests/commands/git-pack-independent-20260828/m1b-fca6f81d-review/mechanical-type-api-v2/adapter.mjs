import { runCase as ownership } from "../mechanical/ownership.mjs";
import { runCase as checkpoints } from "../mechanical/checkpoints.mjs";
import { runCase as counter } from "../mechanical/counter.mjs";
import { diagnosticsMatch, fixtureFor, materializedFixture, sha256, validateResult } from "./protocol.mjs";

const forwarding = new Map([
  ...["S01-reserve-error", "S01-reserve-null", "S01-reserve-undefined", "S01-allocate-error", "S01-allocate-null", "S01-allocate-undefined", "S01-first-reserve", "S01-late-step", "S01-success", "S01-pristine", "S01-reverted", "S01-restored"].map(id => [id, ownership]),
  ...["CHECK-CRC", "CHECK-HASH", "CHECK-REPLAY", "INHERIT-blob", "INHERIT-tree", "INHERIT-commit", "INHERIT-tag"].map(id => [id, checkpoints]),
  ...["COUNTER-pristine", "COUNTER-mutant", "COUNTER-restored"].map(id => [id, counter]),
]);
const typeIds = new Set(["T01", "T02", "T03", "T04", "T05"]);

export async function runCase(api, caseId) {
  if (!typeIds.has(caseId)) {
    const original = forwarding.get(caseId);
    if (!original) throw new Error("Unknown mechanical case ID");
    return original(api, caseId);
  }
  const result = validateResult(await api.compile(caseId));
  await api.capture("compiler-api-result", result);
  const expectedFixture = materializedFixture(caseId, api.candidateRoot);
  api.check("compiler-api-completed-and-guarded", result.completed && result.guards.before === true && result.guards.after === true && result.raw.path === `${api.caseRoot}/type-api-raw.json`);
  api.check("compiler-api-case-and-fixture", result.fixtureId === caseId && result.layout === api.layout &&
    result.fixture.path === `${api.caseRoot}/${caseId}.mts` && result.fixture.subjectRoot === api.candidateRoot &&
    result.fixture.templateSha256 === fixtureFor(caseId).sha256 && result.fixture.bytes === expectedFixture.length && result.fixture.sha256 === sha256(expectedFixture));
  api.check("compiler-api-exact-diagnostic-predicate", result.matched && diagnosticsMatch(caseId, `${api.caseRoot}/${caseId}.mts`, api.candidateRoot, result.diagnostics));
}
