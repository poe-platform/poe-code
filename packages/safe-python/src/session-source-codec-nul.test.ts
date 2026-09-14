import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {sourceCodecNulCases, sourceCodecNulPrecedenceCases, sourceCodecNulServiceCase, sourceCodecSubtypeCases} from "./source-codec-nul-cases.js";
import reference from "./runtime/__snapshots__/source-codec-nul-3.14.7.json";

it.each([...sourceCodecNulCases, ...sourceCodecNulPrecedenceCases, ...sourceCodecSubtypeCases, sourceCodecNulServiceCase])("source codec NUL boundary: $name", ({name, source}) => {
  let output = "";
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    output: {write(text) {output += text;}, flush() {}},
    input: {readLine() {return "ready\n";}}
  });
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
  expect(output).toBe(reference.cases.find(row => row.name === name)!.stdout);
});

it.each([1, 2])("keeps source filename service cancellation terminal at call %s", cancelAt => {
  const controller = new AbortController();
  let reads = 0, output = "";
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    signal: controller.signal,
    input: {readLine() {if (++reads === cancelAt) controller.abort(); return "ready\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(sourceCodecNulServiceCase.source);
  expect(result).toEqual({status: "terminated", reason: "cancelled", message: "execution cancelled"});
  expect(session.exec("pass")).toEqual(result);
  expect(reads).toBe(cancelAt);
  expect(output).toBe("");
});
