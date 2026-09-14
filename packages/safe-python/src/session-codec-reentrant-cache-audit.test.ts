import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecReentrantCacheAuditCases} from "./codec-reentrant-cache-audit-cases.js";
import reference from "./runtime/__snapshots__/codec-reentrant-cache-audit.json" with {type: "json"};

it.each(codecReentrantCacheAuditCases)("codec reentrant cache audit: $name", ({name, source}) => {
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(reference.reference.platform).toBe("darwin");
  expect(reference.reference.byteorder).toBe("little");
  const oracle = reference.cases.find(row => row.name === name)!;
  expect(oracle.source).toBe(source);
  expect(oracle.exitCode).toBe(0);
  expect(oracle.stderr).toBe("");
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 3000000, maxAllocatedBytes: 32000000, maxDepth: 100},
    hashSeed: [1n, 2n], output: {write(text) {output += text;}, flush() {}},
  });
  const result = session.exec(source);
  let diagnostic: unknown;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const message = session.eval("repr(failure)");
    if (message.status === "ok") diagnostic = message.value.primitive;
  }
  expect(result.status, String(diagnostic)).toBe("ok");
  expect(output).toBe(oracle.stdout);
});
