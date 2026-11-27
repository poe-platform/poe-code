import assert from "node:assert/strict";
import test from "node:test";
import { run } from "../helpers.js";

// Verified with GNU coreutils 9.4 on Linux; the Darwin capture remains historical.
const cases = [
  { args: ["-i"], expected: "" },
  { args: ["-i", "A=1", "B=2"], expected: "A=1\nB=2\n" },
  { args: ["-i", "B=2", "A=1"], expected: "B=2\nA=1\n" },
  { args: ["-i", "A=1", "B=2", "C=3"], expected: "A=1\nB=2\nC=3\n" },
  { args: ["-i", "A=1", "B=2", "A=3"], expected: "A=3\nB=2\n" },
  { args: ["-i", "Z=1", "A=2", "M=3"], expected: "Z=1\nA=2\nM=3\n" },
  { args: ["-i", "ONE=1", "TWO=2", "THREE=3", "FOUR=4"], expected: "ONE=1\nTWO=2\nTHREE=3\nFOUR=4\n" },
  { args: ["-i", "1=x", "2=y", "X=z"], expected: "1=x\n2=y\nX=z\n" },
  { args: [], expected: "A=old\nB=parent\nC=before\n" },
  { args: ["NEW=new"], expected: "A=old\nB=parent\nC=before\nNEW=new\n" },
  { args: ["A=new"], expected: "A=new\nB=parent\nC=before\n" },
  { args: ["B=new"], expected: "A=old\nB=new\nC=before\n" },
  { args: ["-u", "A", "C=3"], expected: "B=parent\nC=3\n" },
  { args: ["A=new", "NEW=new"], expected: "A=new\nB=parent\nC=before\nNEW=new\n" },
  { args: ["-u", "A", "A=again"], expected: "B=parent\nC=before\nA=again\n" },
  { args: ["-u", "B", "B=again", "D=new"], expected: "A=old\nC=before\nB=again\nD=new\n" },
  { args: ["-u", "MISSING", "NEW=new"], expected: "A=old\nB=parent\nC=before\nNEW=new\n" },
  { args: ["-i", "EMPTY=", "VALUE=a=b"], expected: "EMPTY=\nVALUE=a=b\n" },
  { args: ["-i", "__proto__=literal", "constructor=value"], expected: "__proto__=literal\nconstructor=value\n" },
  { args: ["-0", "-u", "A", "NEW=new"], expected: "B=parent\0C=before\0NEW=new\0" },
  { args: ["-0", "-i", "A=1", "B=2", "A=3"], expected: "A=3\0B=2\0" },
  { args: ["-i", "A=one\ntwo", "B=three"], expected: "A=one\ntwo\nB=three\n" },
  { args: ["-i", "DUP=1", "DUP=2", "LAST=3", "DUP=4"], expected: "DUP=4\nLAST=3\n" },
];
for (const [index, row] of cases.entries()) test(`GNU/Linux env ordering ${index}: ${row.args.join(" ")}`, async () => {
  const parent = { A: "old", B: "parent", C: "before" };
  const result = await run("env", row.args, { env: parent });
  assert.equal(result.stdout, row.expected);
  assert.equal(result.stderr, "");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(parent, { A: "old", B: "parent", C: "before" });
});
