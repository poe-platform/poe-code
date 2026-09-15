import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {sourceCodecBomCases, sourceCodecDecodingCases, sourceCodecServiceCase, sourceCodecFilenameCase} from "./source-codec-diagnostic-cases.js";
import reference from "./runtime/__snapshots__/source-codec-diagnostics-3.14.7.json";

it.each([...sourceCodecBomCases, ...sourceCodecDecodingCases, sourceCodecServiceCase, sourceCodecFilenameCase])("source codec diagnostic: $name", ({name, source}) => {
  let output = "";
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {return "service.py\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source).status).toBe("ok");
  expect(output).toBe(reference.cases.find(row => row.name === name)!.stdout);
});

it("keeps cancellation fatal during source diagnostic service output", () => {
  const controller = new AbortController();
  let writes = 0;
  const session = new PythonSession({
    hashSeed: [1n, 2n], signal: controller.signal,
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {return "service.py\n";}},
    output: {write() {writes++; controller.abort();}, flush() {}}
  });
  expect(session.exec(sourceCodecServiceCase.source)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(writes).toBe(1);
  expect(session.exec("raise AssertionError('resumed')")).toMatchObject({status: "terminated", reason: "cancelled"});
});
