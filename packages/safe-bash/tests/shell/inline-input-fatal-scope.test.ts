import assert from "node:assert/strict";
import { test } from "node:test";
import { runVirtualBatch } from "../shell-stress/helpers.js";
import type { Observation, StressCase } from "../shell-stress/model.js";

type FatalCase = { name: string; fixture: StressCase; check: (actual: Observation) => void };
const batches: { name: string; cases: FatalCase[] }[] = [];

for (const expansion of ["${VALUE:?stop}", "$((1/0))"]) {
  for (const operator of ["heredoc", "here-string"]) {
    const redirect = operator === "heredoc" ? `<<EOF\n${expansion}\nEOF\n` : `<<<"${expansion}"\n`;
    const cases: FatalCase[] = [];
    for (const [name, command, isolated] of [
      ["builtin", "printf ran", false],
      ["function", "func", false],
      ["brace group", "{ printf ran >executed; }", false],
      ["redirect only", "", false],
      ["external command", "cat", true],
      ["subshell redirect", "( printf ran >executed; )", true],
    ] as const) {
      cases.push({
        name: `${operator} failure scope: ${name} ${expansion}`,
        fixture: {
          name: `${operator} failure scope: ${name}`,
          script: `func() { printf ran >executed; }; ${command} 2>errors ${redirect}status=$?; printf after >marker; exit "$status"`,
        },
        check(actual) {
          const fatal = expansion.startsWith("${") && !isolated;
          const files = fatal ? ["errors"] : ["errors", "marker"];
          assert.equal(actual.exitCode, expansion.startsWith("${") ? 127 : 1);
          for (const observation of [actual]) {
            assert.equal(observation.stdout, "");
            assert.equal(observation.stderr, "");
            assert.deepEqual(Object.keys(observation.files).sort(), files);
            if (!fatal) assert.deepEqual(observation.files.marker, { type: "file", base64: Buffer.from("after").toString("base64") });
            const diagnostic = observation.files.errors;
            assert.ok(diagnostic?.type === "file");
            assert.match(Buffer.from(diagnostic.base64!, "base64").toString(), expansion.startsWith("${") ? /VALUE: stop/u : /division by (?:0|zero)/iu);
          }
        },
      });
    }
    batches.push({ name: `${operator} failure scope batch ${expansion}`, cases });
  }
}

const nestedCases: FatalCase[] = [];
for (const operator of ["heredoc", "here-string"]) {
  const redirect = operator === "heredoc" ? "<<EOF\n${VALUE:?stop}\nEOF\n" : '<<<"${VALUE:?stop}"\n';
  for (const [name, wrap, stdout, status] of [
    ["subshell", (body: string) => `( ${body} );`, "", 1],
    ["pipeline", (body: string) => `{ ${body} } | cat;`, "", 0],
    ["substitution", (body: string) => `value=$( ${body} );`, "", 1],
  ] as const) {
    const body = `printf ran 2>errors ${redirect}printf bad >inner;`;
    nestedCases.push({
      name: `${operator} parameter failure aborts only its ${name} environment`,
      fixture: { name: `${operator} nested fatal ${name}`, script: `${wrap(body)} status=$?; printf after >outer; exit "$status"` },
      check(actual) {
        assert.equal(actual.exitCode, status);
        for (const observation of [actual]) {
          assert.equal(observation.stdout, stdout);
          assert.equal(observation.stderr, "");
          assert.deepEqual(Object.keys(observation.files).sort(), ["errors", "outer"]);
          assert.deepEqual(observation.files.outer, { type: "file", base64: Buffer.from("after").toString("base64") });
        }
      },
    });
  }
}
batches.push({ name: "nested inline-input fatal scope batch", cases: nestedCases });

for (const batch of batches) {
  test(batch.name, async context => {
    const execution = await runVirtualBatch(batch.cases.map(row => row.fixture)).then(result => ({ result }), (error: unknown) => ({ error }));
    if ("result" in execution) {
      const { before, after } = execution.result;
      context.diagnostic(JSON.stringify({ sourceScope: "batch", sourceBefore: before.aggregate, sourceAfter: after.aggregate, timeBefore: before.time, timeAfter: after.time, revision: before.revision, sourceAdmission: before.sourceAdmission }));
    }
    for (const [index, row] of batch.cases.entries()) {
      await context.test(row.name, () => {
        if ("error" in execution) throw execution.error;
        const outcome = execution.result.outcomes[index]!;
        assert.ok(outcome.status === "fulfilled", JSON.stringify(outcome));
        row.check(outcome.observation);
      });
    }
  });
}
