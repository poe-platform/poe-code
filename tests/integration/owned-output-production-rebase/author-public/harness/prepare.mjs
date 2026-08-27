import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { directory, json, verifyReference, verifyTooling, writeJson } from "./common.mjs";
import { expectedPrivateProfile, materializeFrozenFixtures } from "./safejs-binding.mjs";

const output = realpathSync(mkdtempSync("/tmp/safe-bash-author-public-preparation-"));
const references = json(join(directory, "profiles/REFERENCES.json"));
for (const reference of references.files) verifyReference(reference);
const tooling = verifyTooling();
const historicalPrivateProfile = expectedPrivateProfile();
assert.equal(historicalPrivateProfile.engine.length, 264);
const fixture = materializeFrozenFixtures(join(output, "frozen-reference-fixtures"));
const report = { status: "PREPARED_NOT_EXECUTED", date: "2026-08-27", qualification: "AUTHOR_ONLY_NOT_INDEPENDENT_ACCEPTANCE", sealedReferences: references.files.length, tooling: { node: tooling.node, packages: tooling.packages.map(({ files, ...tool }) => tool) }, fixture, historicalPrivateMetadataDerivedWithoutPrivateQuery: true, candidateExecutions: 0, builds: 0, privateQueries: 0, privateImports: 0, guestRuns: 0, transportCalls: 0, pending: ["ROOT frozen current candidate and release", "current source archive/build/package/moved public consumer", "strict consumer and feasible unchanged maintained typecheck", "curl+cat mixed destinations and original five separate requirements", "current compiled loader/supervisor binding", "fresh private precondition and before/after per actual cohort", "actual-current SafeJS surface8/lifecycle11/zero6", "different final verification remains with Curie"] };
writeJson(join(output, "PREPARATION.json"), report);
console.log(JSON.stringify({ status: report.status, output, fixtureRows: 25, candidateExecutions: 0, privateQueries: 0 }));
