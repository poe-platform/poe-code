import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/codec-byte-rejection-services-2026-09-14.json";

it.each(reference.cases)("preserves native byte transform diagnostics: $name", row => {
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(reference.reference.platform).toBe("darwin");
  expect(reference.reference.byteorder).toBe("little");
  expect(row.oracle.status).toBe(0);
  expect(row.oracle.stderr).toBe("");
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n],
    output: {write(text) {output += text;}, flush() {}},
  });
  const result = session.exec(row.source);
  expect(result.status, result.status === "terminated" ? result.message : output).toBe("ok");
  expect(output).toBe(row.oracle.stdout);
});
