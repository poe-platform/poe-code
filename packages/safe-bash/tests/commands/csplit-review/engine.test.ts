import assert from "node:assert/strict";
import test from "node:test";
import { searchBreSteps } from "../../../src/commands/expr/bre-engine.js";
import { exprMatchCeilings, type BreSearchDescriptor, type BreSearchResult } from "../../../src/commands/regex-execution/protocol.js";
import { nativeCases } from "./native-cases.js";
import { finiteCases } from "./finite-cases.js";

function finish(execution: Generator<void, BreSearchResult>): BreSearchResult {
  let step = execution.next();
  while (!step.done) step = execution.next();
  return step.value;
}

function descriptor(pattern: string, profile: BreSearchDescriptor["profile"] = "byte"): BreSearchDescriptor {
  return { kind: "bre-search", pattern: Buffer.from(pattern), profile, limits: exprMatchCeilings };
}

for (const fixture of [...nativeCases, ...finiteCases]) test(`independent GNU search: ${fixture.locale} ${fixture.name}`, () => {
  const result = finish(searchBreSteps(descriptor(fixture.pattern, fixture.locale === "C" ? "byte" : "utf8-scalar"), Buffer.from(fixture.subjectBase64, "base64")));
  assert.equal(result.matched, fixture.status === 0, `${fixture.name}: ${fixture.stderr}`);
  assert.equal(result.offsetUnit, "byte");
  assert.equal(result.overall === null, !result.matched);
});

for (const profile of ["byte", "utf8-scalar"] as const) {
  for (const [pattern, subject, overall] of [
    ["xy", "aaxy", { start: 2, end: 4 }],
    ["^xy", "aaxy", null],
    ["\\`xy", "aaxy", null],
    ["xy\\'", "aaxy", { start: 2, end: 4 }],
    ["$", "abc", { start: 3, end: 3 }],
    ["\\<xy", "!xy", { start: 1, end: 3 }],
    ["\\<xy", "axy", null],
    ["xy\\>", "axy!", { start: 1, end: 3 }],
    ["\\Bxy", "axy", { start: 1, end: 3 }],
    ["é\\+", "zzéé", { start: 2, end: profile === "byte" ? 4 : 6 }],
    ["\\(a\\|aa\\)*\\1b", "zaaaab", { start: 1, end: 6 }],
  ] as const) test(`absolute byte offsets ${profile}: ${pattern}`, () => {
    assert.deepEqual(finish(searchBreSteps(descriptor(pattern, profile), Buffer.from(subject))).overall, overall);
  });
}

test("candidate search shares its total work rather than resetting per candidate", () => {
  const selected = descriptor("z");
  const subject = Buffer.from("aaaaaaaaaaaaaaaaaaaaaaaa");
  const completed = finish(searchBreSteps(selected, subject));
  assert.equal(completed.matched, false);
  assert.throws(() => finish(searchBreSteps({ ...selected, limits: { ...selected.limits, maxSteps: completed.steps - 1 } }, subject)), { category: "limit" });
  assert.deepEqual(finish(searchBreSteps({ ...selected, limits: { ...selected.limits, maxSteps: completed.steps } }, subject)), completed);
});

test("candidate starts share a state ceiling even for nonbranching patterns", () => {
  const selected = descriptor("z");
  assert.equal(finish(searchBreSteps({ ...selected, limits: { ...selected.limits, maxStates: 3 } }, Buffer.from("aa"))).matched, false);
  assert.throws(() => finish(searchBreSteps({ ...selected, limits: { ...selected.limits, maxStates: 2 } }, Buffer.from("aa"))), { category: "limit" });
});
