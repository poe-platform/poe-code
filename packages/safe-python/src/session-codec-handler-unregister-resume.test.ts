import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecHandlerUnregisterResumeCases} from "./codec-handler-unregister-resume-cases.js";
import reference from "./runtime/__snapshots__/codec-handler-unregister-resume-3.14.7.json";

it.each(codecHandlerUnregisterResumeCases)("$name", ({name, source}) => {
  const oracle = reference.cases.find(row => row.name === name)!;
  expect(oracle).toMatchObject({source, status: 0, stderr: ""});
  expect(reference.target).toMatchObject({unicode: "16.0.0", platform: "darwin", byteorder: "little"});
  expect(reference.target.version.startsWith("3.14.7 ")).toBe(true);
  let output = "", reads = 0;
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {reads++; return "ready\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(source);
  expect({result, output}).toEqual({result: {status: "ok"}, output: oracle.stdout});
  expect(reads).toBeGreaterThanOrEqual(2);
});

it.each(codecHandlerUnregisterResumeCases)("$name keeps cancellation terminal", ({source}) => {
  for (const throws of [false, true]) {
    const controller = new AbortController();
    let reads = 0, output = "";
    const session = new PythonSession({
      hashSeed: [1n, 2n], signal: controller.signal,
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
      input: {readLine() {
        reads++;
        controller.abort();
        if (throws) throw new Error("input service failed after cancellation");
        return "ready\n";
      }},
      output: {write(text) {output += text;}, flush() {}}
    });
    expect(session.exec(source)).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(session.exec("print('resumed')")).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(reads).toBe(1);
    expect(output).toBe("");
  }
});
