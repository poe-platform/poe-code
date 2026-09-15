import {expect, it} from "vitest";
import {setImmediate} from "node:timers/promises";
import {PythonSession} from "./index.js";
import {codecFragmentedFailureCases} from "./codec-fragmented-failure-cases.js";
import reference from "./runtime/__snapshots__/codec-fragmented-failures-3.14.7.json" with {type: "json"};

it.each(codecFragmentedFailureCases)("fragmented codec failure: $name", async ({name, source}) => {
  // Let weakly held native class descendants from the preceding interpreter
  // become collectible before constructing another complete guest library.
  await setImmediate();
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
