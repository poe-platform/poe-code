import {expect, it} from "vitest";
import {createHash} from "node:crypto";
import {PythonSession} from "./index.js";
import {codecBoundaryAuditPrograms} from "./codec-boundary-audit-cases.js";
import reference from "./runtime/__snapshots__/codec-boundary-audit-public-oracle.json";

it.each(codecBoundaryAuditPrograms)("public boundary audit: $name", ({name, source}) => {
  const oracle = reference.rows.find(row => row.name === name)!;
  expect(createHash("sha256").update(source).digest("hex")).toBe(oracle.sourceSha256);
  expect(oracle.status).toBe(0);
  expect(oracle.stderr).toBe("");
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 2000000, maxAllocatedBytes: 32000000, maxDepth: 100},
    hashSeed: [1n, 2n], output: {write(text) {output += text;}, flush() {}},
  });
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("repr(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
  expect(output).toBe(oracle.stdout);
});
