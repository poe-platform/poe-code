import assert from "node:assert/strict";
import { after, test } from "node:test";
import { RegexExecutor } from "../../../../src/commands/regex-execution/client.js";
import { ExprMatchError, RegexExecutionError, exprMatchCeilings, type ExprMatchLimits } from "../../../../src/commands/regex-execution/protocol.js";
import { run } from "../helpers.js";

const executor = new RegexExecutor();
const session = executor.open(new AbortController().signal);
after(async () => { await session.close(); await executor.dispose(); });
const match = (subject: string, pattern: string, limits: Partial<ExprMatchLimits> = {}) =>
  session.matchExpr({ kind: "expr-match", pattern: Buffer.from(pattern), profile: "byte", limits: { ...exprMatchCeilings, ...limits } }, Buffer.from(subject));

for (const [subject, end, captureStart, captureEnd] of [["", 0, 0, 0], ["a", 0, 0, 0], ["aa", 2, 0, 1], ["aaa", 3, 1, 2]] as const) {
  test(`provisional sole-empty/first-completed policy: original subject ${JSON.stringify(subject)}`, async () => {
    const result = await match(subject, "\\(a*\\)*\\1");
    assert.equal(result.matched, true);
    assert.deepEqual(result.overall, { start: 0, end });
    assert.deepEqual(result.capture, { start: captureStart, end: captureEnd });
  });
}

for (const pattern of ["\\(a*\\)\\{2\\}\\1", "\\(\\)\\{2\\}\\1", "\\(\\(a*\\)\\{2\\}\\)\\{3\\}\\2"]) {
  test(`required empty iterations finish with completed captures: ${pattern}`, async () => {
    const result = await match("", pattern);
    assert.equal(result.matched, true);
    assert.deepEqual(result.overall, { start: 0, end: 0 });
    assert.deepEqual(result.capture, { start: 0, end: 0 });
  });
}

for (const pattern of ["\\(a*\\)\\{0\\}\\1", "\\(\\)\\{0\\}\\1"]) {
  test(`zero iterations leave captures absent: ${pattern}`, async () => {
    const result = await match("", pattern);
    assert.equal(result.matched, false);
    assert.equal(result.overall, null); assert.equal(result.capture, null);
  });
}

test("static repeat identity does not unroll 1000 required empty copies into nodes", async () => {
  const result = await match("", "\\(\\)\\{1000\\}\\1", { maxNodes: 16 });
  assert.equal(result.matched, true);
  assert.deepEqual(result.capture, { start: 0, end: 0 });
});

for (const limit of ["maxSteps", "maxAllocatedUnits"] as const) {
  test(`required progress counts remain bounded by ${limit}`, async () => {
    await assert.rejects(match("", "\\(\\)\\{32767\\}\\1", { [limit]: 10_000 }),
      error => error instanceof ExprMatchError && error.category === "limit");
  });
}

test("nullable branch state admission rejects before publishing an earlier match", async () => {
  await assert.rejects(match("aaaaaa", "\\(a*\\)*\\1", { maxStates: 10 }),
    error => error instanceof ExprMatchError && error.category === "limit");
});

test("original prototype regressions stay fixed to existing CLI bytes, not flat capture length", async () => {
  for (const [pattern, expected] of [["\\(a*\\)\\{2\\}", "\n"], ["\\(a\\|aa\\)a*", "a\n"]] as const) {
    const result = await run(["+", "aaa", ":", pattern]);
    assert.equal(result.stdout, expected); assert.equal(result.stderr, "");
    assert.equal(result.exitCode, expected === "\n" ? 1 : 0);
  }
});

test("actual CLI aaa is a completed witness, not GNU's unfinished-register empty output", async () => {
  const result = await run(["+", "aaa", ":", "\\(a*\\)*\\1"]);
  assert.equal(result.stdout, "a\n"); assert.equal(result.stderr, ""); assert.equal(result.exitCode, 0);
});

test("nullable capture obeys exact suffix and anchor continuation", async () => {
  for (const [subject, pattern, end] of [["aaa", "\\(a*\\)*\\1$", 3], ["aaab", "\\(a*\\)*\\1b", 4]] as const) {
    const result = await match(subject, pattern);
    assert.equal(result.matched, true); assert.deepEqual(result.overall, { start: 0, end });
    assert.deepEqual(result.capture, { start: 1, end: 2 });
  }
  assert.equal((await match("aaa\n", "\\(a*\\)*\\1$")).matched, false);
});

test("provisional descendant last-participation survives a skipped later inner group", async () => {
  const result = await match("abab", "\\(a\\(b\\)*\\)*\\2");
  assert.deepEqual(result.overall, { start: 0, end: 4 });
  assert.deepEqual(result.capture, { start: 2, end: 3 });
});

test("63 bounded subjects have complete witnesses and maximal whole endpoints under the provisional empty rule", async () => {
  const subjects = [""];
  for (let length = 1; length <= 5; length++) {
    for (let encoded = 0; encoded < 2 ** length; encoded++) {
      let subject = "";
      for (let digit = 0; digit < length; digit++) subject += encoded & 2 ** digit ? "a" : "b";
      subjects.push(subject);
    }
  }
  assert.equal(subjects.length, 63);
  for (const subject of subjects) {
    const witnesses = [{ end: 0, start: 0, stop: 0 }];
    const extend = (position: number): void => {
      for (let stop = position + 1; stop <= subject.length; stop++) {
        if (subject[stop - 1] !== "a") break;
        const captured = subject.slice(position, stop);
        if (subject.slice(stop, stop + captured.length) === captured) witnesses.push({ end: stop + captured.length, start: position, stop });
        extend(stop);
      }
    };
    extend(0);
    const result = await match(subject, "\\(a*\\)*\\1");
    assert.equal(result.matched, true, subject);
    assert.equal(result.overall?.end, Math.max(...witnesses.map(witness => witness.end)), subject);
    assert.ok(witnesses.some(witness => result.overall?.end === witness.end && result.capture?.start === witness.start && result.capture.end === witness.stop), subject);
  }
});

for (const [name, subject, pattern] of [
  ["nullable", "aaa", "\\(a*\\)*\\1"],
  ["required-empty", "", "\\(\\)\\{8\\}\\1"],
  ["branch-rollback", "abab", "\\(a\\|ab\\)\\1"],
  ["nested", "abab", "\\(a\\(b\\)*\\)*\\2"],
] as const) {
  for (const limit of ["maxSteps", "maxAllocatedUnits", "maxNodes", "maxStates"] as const) {
    test(`exact ${limit} admission boundary: ${name}`, { timeout: 20_000 }, async context => {
      const expected = await match(subject, pattern);
      let rejected = 0, admitted = exprMatchCeilings[limit];
      while (admitted - rejected > 1) {
        const trial = Math.floor((admitted + rejected) / 2);
        try {
          assert.deepEqual(await match(subject, pattern, { [limit]: trial }), expected);
          admitted = trial;
        } catch (error) {
          assert.ok(error instanceof ExprMatchError && error.category === "limit", String(error));
          rejected = trial;
        }
      }
      assert.deepEqual(await match(subject, pattern, { [limit]: admitted }), expected);
      if (rejected === 0) {
        assert.equal(limit, "maxStates"); assert.equal(name, "required-empty"); assert.equal(admitted, 1);
        assert.throws(() => match(subject, pattern, { [limit]: rejected }),
          error => error instanceof RegexExecutionError && error.code === "PROTOCOL");
      } else {
        await assert.rejects(match(subject, pattern, { [limit]: rejected }),
          error => error instanceof ExprMatchError && error.category === "limit");
      }
      context.diagnostic(JSON.stringify({ name, limit, admitted, rejected, rejection: rejected ? "engine-limit" : "protocol-minimum" }));
    });
  }
}
