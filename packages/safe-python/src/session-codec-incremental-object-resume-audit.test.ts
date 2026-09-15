import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecIncrementalObjectResumeAuditCases} from "./codec-incremental-object-resume-audit-cases.js";
import reference from "./runtime/__snapshots__/codec-incremental-object-resume-audit-3.14.7.json";

it.each(codecIncrementalObjectResumeAuditCases)("incremental object replacement: $name", ({name, source}) => {
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.platform).toBe("darwin");
  expect(reference.oracle.byteorder).toBe("little");
  const row = reference.cases.find(candidate => candidate.name === name)!;
  expect(row.source).toBe(source);
  let output = "";
  const session = new PythonSession({hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    output: {write(text) {output += text;}, flush() {}}});
  const result = session.exec(source);
  expect(result.status, output).toBe("ok");
  expect(output).toBe(row.stdout);
});
