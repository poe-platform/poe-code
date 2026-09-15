import {createHash} from "node:crypto";
import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecRecoveryRegistrySwapCases} from "./codec-recovery-registry-swap-cases.js";
import reference from "./runtime/__snapshots__/codec-recovery-registry-swap-3.14.7.json";

const limits = {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100};

it("pins the unchanged registry-swap programs to the reference platform", () => {
  expect(reference.target).toMatchObject({unicode: "16.0.0", platform: "darwin", byteorder: "little"});
  expect(reference.target.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.rows).toHaveLength(codecRecoveryRegistrySwapCases.length);
});

it.each(codecRecoveryRegistrySwapCases)("retains decoder state during registry replacement: $name", ({name, source}) => {
  const oracle = reference.rows.find(row => row.name === name)!;
  expect(oracle).toMatchObject({source, status: 0, stderr: "", sha256: createHash("sha256").update(source).digest("hex")});
  let output = "", reads = 0;
  const session = new PythonSession({limits, hashSeed: [1n, 2n],
    input: {readLine() {reads++; return "ready\n";}},
    output: {write(text) {output += text;}, flush() {}}
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
  expect(reads).toBe(1);
});

it.each(codecRecoveryRegistrySwapCases.flatMap(row => [false, true].map(throws => ({...row, throws}))))(
  "keeps cancellation during registry replacement terminal: $name; throws=$throws", ({source, throws}) => {
    const controller = new AbortController();
    let reads = 0, writes = 0;
    const session = new PythonSession({limits, signal: controller.signal, hashSeed: [1n, 2n],
      input: {readLine() {
        reads++;
        controller.abort();
        if (throws) throw new Error("read failed after cancellation");
        return "ready\n";
      }}, output: {write() {writes++;}, flush() {}}
    });
    const result = session.exec(source);
    expect(result.status).toBe("terminated");
    if (result.status === "terminated") expect(result.reason).toBe("cancelled");
    expect(reads).toBe(1);
    const previousWrites = writes;
    expect(session.exec("print('continued')")).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(reads).toBe(1);
    expect(writes).toBe(previousWrites);
  }
);
