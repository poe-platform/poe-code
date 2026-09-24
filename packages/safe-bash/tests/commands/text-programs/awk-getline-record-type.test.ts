import assert from "node:assert/strict";
import test from "node:test";
import { runVirtual } from "./helpers.js";

for (const counter of ["NR", "FNR"]) {
  test(`awk getline evaluates its target after advancing ${counter}`, async () => {
    const result = await runVirtual("awk", {
      args: [`{ getline a[${counter}]; print NR, FNR, a[1], a[2] }`], stdin: "first\nsecond\n",
    });
    assert.equal(result.exitCode, 0, result.stderr.toString());
    assert.equal(result.stdout.toString(), "2 2  second\n");
  });
}

test("awk getline can be the left operand of array membership", async () => {
  const result = await runVirtual("awk", {
    args: ['BEGIN { a[1]="yes" } { if (getline in a) print "matched:", $0 }'], stdin: "first\nsecond\n",
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "matched: second\n");
});

test("awk record assignment preserves scalar type and field rebuild produces a string", async () => {
  const result = await runVirtual("awk", {
    args: ['{ print ($0 == 1); $0="01"; print ($0 == 1); $1="01"; print ($0 == 1); $0=1; print ($0 == 1) }'], stdin: "01\n",
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "1\n0\n0\n1\n");
});

test("awk getline restores input scalar typing after record assignment", async () => {
  const result = await runVirtual("awk", {
    args: ['{ $0="01"; getline; print ($0 == 1); getline $0; print ($0 == 1) }'], stdin: "first\n01\n01\n",
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  assert.equal(result.stdout.toString(), "1\n1\n");
});
