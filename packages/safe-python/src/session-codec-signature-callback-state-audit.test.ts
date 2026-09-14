import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {signatureCallbackStateAuditCases} from "./codec-signature-callback-state-audit-cases.js";
import reference from "./runtime/__snapshots__/codec-signature-callback-state-audit-3.14.7.json";

it("pins signature callback state to CPython 3.14.7 and Unicode 16", () => {
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.byteorder).toBe("little");
  expect(reference.oracle.platform).toBe("darwin");
  expect(reference.cases.map(({name, source}) => ({name, source}))).toEqual(signatureCallbackStateAuditCases);
});

it.each(signatureCallbackStateAuditCases)("signature callback state: $name", ({name, source}) => {
  let output = "";
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source).status).toBe("ok");
  expect(output).toBe(reference.cases.find(row => row.name === name)!.stdout);
});
