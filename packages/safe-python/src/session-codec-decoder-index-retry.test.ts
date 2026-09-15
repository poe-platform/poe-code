import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecDecoderIndexRetryCases} from "./codec-decoder-index-retry-cases.js";
import reference from "./runtime/__snapshots__/codec-decoder-index-retry-oracle.json" with {type: "json"};

it.each(codecDecoderIndexRetryCases)("$encoding buffered decoder retries after resume-index failure", ({encoding, source}) => {
  const row = reference.cases.find(candidate => candidate.encoding === encoding)!;
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference).toMatchObject({unicode: "16.0.0", platform: "darwin", byteorder: "little"});
  expect(row.source).toBe(source);
  expect(row.status).toBe(0);
  expect(row.stderr).toBe("");
  let output = "";
  const independent = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 1000},
    hashSeed: [1n, 2n],
    input: {readLine() {return "continue\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  for (const throws of [false, true]) {
    const controller = new AbortController();
    let reads = 0, cancelledOutput = "";
    const cancelled = new PythonSession({
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 1000},
      hashSeed: [3n, 4n], signal: controller.signal,
      input: {readLine() {
        reads++;
        controller.abort();
        if (throws) throw new Error("input failed after abort");
        return "continue\n";
      }},
      output: {write(text) {cancelledOutput += text;}, flush() {}}
    });
    const failure = cancelled.exec(source);
    expect(failure).toEqual({status: "terminated", reason: "cancelled", message: "execution cancelled"});
    const retainedOutput = cancelledOutput;
    expect(cancelled.exec(source)).toEqual(failure);
    expect(cancelled.eval("1")).toEqual(failure);
    expect(reads).toBe(1);
    expect(cancelledOutput).toBe(retainedOutput);
    const result = independent.exec(source);
    let diagnostic = "";
    if (result.status === "exception") {
      independent.globals.set("failure", result.exception);
      const detail = independent.eval("str(failure)");
      if (detail.status === "ok") diagnostic = String(detail.value.primitive);
    }
    expect(result.status, diagnostic).toBe("ok");
    expect(output).toBe(row.stdout);
    output = "";
  }
});
