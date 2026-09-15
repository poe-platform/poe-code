import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecLazyIteratorUserCases} from "./codec-lazy-iterator-user-cases.js";
import reference from "./runtime/__snapshots__/codec-lazy-iterator-user-3.14.7.json" with {type: "json"};

it.each(codecLazyIteratorUserCases)("lazy codec iterator: $name", ({name, source}) => {
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(reference.reference.platform).toBe("macOS-26.4.1-arm64-arm-64bit-Mach-O");
  expect(reference.reference.byteorder).toBe("little");
  const row = reference.cases.find(candidate => candidate.name === name)!;
  expect(row.source).toBe(source);
  expect(row.status).toBe(0);
  expect(row.stderr).toBe("");
  let output = "", reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n],
    input: {readLine() {reads++; return "continue\n";}},
    output: {write(text) {output += text;}, flush() {}},
  });
  const result = session.exec(source);
  expect(result.status).toBe("ok");
  expect(reads).toBe(1);
  expect(output).toBe(row.stdout);
});

it.each(codecLazyIteratorUserCases.flatMap(row => [false, true].map(throws => ({...row, throws}))))(
  "lazy codec iterator cancellation: $name, throws=$throws", ({source, throws}) => {
    const controller = new AbortController();
    let reads = 0, writes = 0;
    const session = new PythonSession({
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
      hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() {
        reads++;
        controller.abort();
        if (throws) throw Error("cancelled input service");
        return "continue\n";
      }},
      output: {write() {writes++;}, flush() {}},
    });
    const terminated = {status: "terminated", reason: "cancelled", message: "execution cancelled"};
    expect(session.exec(source)).toEqual(terminated);
    expect(session.exec("raise AssertionError('resumed')")).toEqual(terminated);
    expect(session.eval("1")).toEqual(terminated);
    expect(reads).toBe(1);
    expect(writes).toBe(0);
  }
);
