import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/codec-replaced-input-fd-september14.json" with {type: "json"};

it.each(reference.rows)("resumes $name in replaced input after a serviced negative index ($mode)", row => {
  expect(reference.target.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.target).toMatchObject({unicode: "16.0.0", platform: "darwin", byteorder: "little"});
  expect(row.oracle).toMatchObject({status: 0, stderr: ""});
  expect(row.matched).toBe(true);
  const controller = new AbortController();
  let reads = 0, output = "";
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    signal: controller.signal,
    input: {readLine() {
      reads++;
      if (row.mode !== "return") controller.abort();
      if (row.mode === "cancel-throw") throw new Error("file adapter failed after cancellation");
      return "resume\n";
    }},
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(row.source);
  expect(reads).toBe(1);
  if (row.mode === "return") {
    expect(result.status).toBe("ok");
    expect(output).toBe(row.oracle.stdout);
  } else {
    expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(output).toBe(row.stdout);
    expect(session.exec("raise AssertionError('resumed after cancellation')"))
      .toMatchObject({status: "terminated", reason: "cancelled"});
    expect(reads).toBe(1);
  }
});
