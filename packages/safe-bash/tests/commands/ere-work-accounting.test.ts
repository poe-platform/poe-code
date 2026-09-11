import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { EreLedger } from "../../src/commands/regex-execution/ere/limits.js";
import { matchEre } from "../../src/commands/regex-execution/ere/matcher.js";
import { compileEre } from "../../src/commands/regex-execution/ere/syntax.js";
import type { EreFragment, EreResource } from "../../src/commands/regex-execution/ere/types.js";

const bounds = { maxExpansionBytes: 1_048_576, maxExpansionFields: 8192 };

interface Admission {
  readonly resource: EreResource;
  readonly amount: number;
}

class ObservedLedger extends EreLedger {
  readonly admissions: Admission[] = [];
  observe: ((admission: Admission) => void) | undefined;

  override charge(resource: EreResource, amount: number, signal?: AbortSignal): void {
    super.charge(resource, amount, signal);
    const admission = { resource, amount };
    this.admissions.push(admission);
    this.observe?.(admission);
  }
}

test("ERE work grows with capture/history copy width", async () => {
  for (const groups of [4, 8, 16, 32]) {
    const ledger = new EreLedger(bounds);
    const program = await compileEre("()".repeat(groups), ledger);
    const before = ledger.usage;
    const result = await matchEre(program, "", ledger);
    assert.deepEqual(result.values, new Array<string>(groups + 1).fill(""));
    assert.ok(ledger.usage.work - before.work >= 2 * groups * (groups + 1), `${groups} groups must pay for both close copies`);
  }
});

test("ERE copy work cannot fit under the old task-only budget", async () => {
  const ledger = new EreLedger(bounds, { work: 322 });
  const program = await compileEre("()".repeat(32), ledger);
  await assert.rejects(matchEre(program, "", ledger), { resource: "work", status: 3 });
  assert.ok(ledger.usage.work <= 322);
});

test("ERE initial capture storage is work-admitted before allocation", async () => {
  const pattern = "()".repeat(8);
  const measured = new EreLedger(bounds);
  await compileEre(pattern, measured);
  const ledger = new EreLedger(bounds, { work: measured.usage.work + 17 });
  const program = await compileEre(pattern, ledger);
  const before = ledger.usage;
  await assert.rejects(matchEre(program, "", ledger), { resource: "work" });
  assert.equal(ledger.usage.allocationUnits, before.allocationUnits);
  assert.equal(ledger.usage.states, 0);
});

test("ERE initialization, reset, close and result copies admit work before storage", async () => {
  const ledger = new ObservedLedger(bounds);
  const program = await compileEre("((a))", ledger);
  ledger.admissions.length = 0;
  assert.deepEqual((await matchEre(program, "a", ledger)).values, ["a", "a", "a"]);
  for (const [allocation, work, count] of [[7, 6, 1], [6, 3, 1], [12, 6, 2], [13, 9, 1]]) {
    const indices = ledger.admissions.flatMap((admission, index) => admission.resource === "allocationUnits" && admission.amount === allocation ? [index] : []);
    assert.equal(indices.length, count, `allocation ${allocation}`);
    for (const index of indices) assert.deepEqual(ledger.admissions[index - 1], { resource: "work", amount: work });
  }
});

for (const size of [8, 10]) {
  test(`ERE equal histories use linear charged comparison at ${size} bytes`, async () => {
    const work = 2 ** size * (6 * size + 32);
    const ledger = new EreLedger(bounds, { work });
    const program = await compileEre("(a|a)*$", ledger);
    const subject = "a".repeat(size);
    const result = await matchEre(program, subject, ledger);
    assert.deepEqual(result.values, [subject, "a"]);
    assert.ok(ledger.usage.work <= work);
    assert.equal(ledger.usage.states, 15 * 2 ** size - 6);
  });
}

test("ERE history scratch is size-admitted for every comparison without cache reuse", async () => {
  const ledger = new ObservedLedger(bounds);
  const program = await compileEre("(a|a)*$", ledger);
  for (let attempt = 0; attempt < 2; attempt++) {
    ledger.admissions.length = 0;
    assert.deepEqual((await matchEre(program, "a".repeat(8), ledger)).values, ["a".repeat(8), "a"]);
    const indices = ledger.admissions.flatMap((admission, index) => admission.resource === "allocationUnits" && admission.amount === 9 ? [index] : []);
    assert.equal(indices.length, 2 * (2 ** 8 - 1));
    for (const index of indices) assert.deepEqual(ledger.admissions[index - 1], { resource: "work", amount: 8 });
  }
});

test("ERE refuses scratch when its allocation reservation cannot fit", async () => {
  const measured = new ObservedLedger(bounds);
  const program = await compileEre("(a|a)*$", measured);
  let firstScratch = 0;
  measured.observe = admission => {
    if (admission.resource === "allocationUnits" && admission.amount === 9 && firstScratch === 0) firstScratch = measured.usage.allocationUnits;
  };
  await matchEre(program, "a".repeat(8), measured);
  assert.ok(firstScratch > 0);
  const ledger = new ObservedLedger(bounds, { allocationUnits: firstScratch - 1 });
  const boundedProgram = await compileEre("(a|a)*$", ledger);
  await assert.rejects(matchEre(boundedProgram, "a".repeat(8), ledger), { resource: "allocationUnits", status: 3 });
  assert.equal(ledger.usage.allocationUnits, firstScratch - 9);
  assert.equal(ledger.admissions.some(admission => admission.resource === "allocationUnits" && admission.amount === 9), false);
});

for (const reason of [0, { history: "abort materialization" }]) {
  test(`ERE history materialization preserves ${typeof reason} abort identity`, async () => {
    const ledger = new ObservedLedger(bounds);
    const program = await compileEre("(a|a)*$", ledger);
    const controller = new AbortController();
    let scratch = false;
    let visits = 0;
    ledger.observe = admission => {
      if (admission.resource === "allocationUnits" && admission.amount === 9) scratch = true;
      else if (scratch && admission.resource === "work" && admission.amount === 1 && ++visits === 2) controller.abort(reason);
    };
    await assert.rejects(matchEre(program, "a".repeat(8), ledger, controller.signal), error => error === reason);
    assert.equal(visits, 2);
    const settled = ledger.usage;
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.deepEqual(ledger.usage, settled);
  });
}

interface ReferenceCase {
  readonly id: string;
  readonly pattern: string | readonly EreFragment[];
  readonly subject: string;
  readonly values?: readonly string[] | null;
  readonly spans?: readonly (readonly [number, number] | null)[];
  readonly error?: string;
  readonly status?: number;
  readonly cardinality?: number;
}

for (const filename of ["cases-v2.json", "native-visible.json"]) {
  const fixtures = JSON.parse(await readFile(new URL(`../compatibility/bash-ere-engine-author-20260829/r01-v1/${filename}`, import.meta.url), "utf8")) as readonly ReferenceCase[];
  for (const fixture of fixtures) {
    test(`ERE existing ${filename} reference ${fixture.id}`, async () => {
      const ledger = new EreLedger(bounds);
      if (fixture.error || fixture.status === 2) {
        await assert.rejects(async () => matchEre(await compileEre(fixture.pattern, ledger), fixture.subject, ledger), fixture.error ? { name: fixture.error, status: 2 } : { status: 2 });
        return;
      }
      const result = await matchEre(await compileEre(fixture.pattern, ledger), fixture.subject, ledger);
      assert.equal(result.matched, fixture.status === undefined ? fixture.values !== null : fixture.status === 0);
      if (fixture.values !== null) assert.deepEqual(result.values, fixture.values);
      if (fixture.spans) assert.deepEqual(result.captures.map(span => span === null ? null : [span.start, span.end]), fixture.spans);
      if (fixture.cardinality !== undefined) assert.equal(result.values.length, fixture.cardinality);
      assert.equal(Object.isFrozen(result), true);
      assert.equal(Object.isFrozen(result.captures), true);
      assert.equal(Object.isFrozen(result.values), true);
    });
  }
}
