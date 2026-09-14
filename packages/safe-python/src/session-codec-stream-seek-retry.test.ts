import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecStreamSeekRetryCases} from "./codec-stream-seek-retry-cases.js";
import reference from "./runtime/__snapshots__/codec-stream-seek-retry-3.14.7.json";

it("pins stream seek/retry evidence to the required reference platform", () => {
  expect(reference.oracle.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.oracle.unicode).toBe("16.0.0");
  expect(reference.oracle.platform).toBe("macOS-26.4.1-arm64-arm-64bit-Mach-O");
  expect(reference.oracle.byteorder).toBe("little");
  expect(reference.cases).toHaveLength(codecStreamSeekRetryCases.length);
  for (const row of reference.cases) {
    expect(row.status).toBe(0);
    expect(row.stderr).toBe("");
  }
});

it.each(codecStreamSeekRetryCases)("stream seek/retry: $name", ({name, source}) => {
  let output = "", reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 2000000, maxAllocatedBytes: 32000000, maxDepth: 150},
    hashSeed: [1n, 2n],
    input: {readLine() { reads++; return "continue\n"; }},
    output: {write(text) { output += text; }, flush() {}},
  });
  expect(session.exec(source)).toMatchObject({status: "ok"});
  expect(reads).toBe(1);
  const expected = reference.cases.find(row => row.name === name)!;
  expect(source).toBe(expected.source);
  expect(output).toBe(expected.stdout);
});

it.each(codecStreamSeekRetryCases.flatMap(row => [false, true].map(throws => ({...row, throws}))))(
  "stream seek/retry cancellation: $name, service throws=$throws", ({source, throws}) => {
    const controller = new AbortController();
    let reads = 0, writesAfterCancellation = 0;
    const session = new PythonSession({
      limits: {maxSteps: 2000000, maxAllocatedBytes: 32000000, maxDepth: 150},
      signal: controller.signal,
      hashSeed: [1n, 2n],
      input: {readLine() {
        reads++;
        controller.abort();
        if (throws) throw new Error("read cancelled");
        return "continue\n";
      }},
      output: {write() { if (controller.signal.aborted) writesAfterCancellation++; }, flush() {}},
    });
    const result = session.exec(source);
    expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(session.exec("pass")).toEqual(result);
    expect(session.eval("1")).toEqual(result);
    expect(reads).toBe(1);
    expect(writesAfterCancellation).toBe(0);
  },
);
