import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecHandlerRetentionUserCases} from "./codec-handler-retention-user-cases.js";
import reference from "./runtime/__snapshots__/codec-handler-retention-user-3.14.7.json" with {type: "json"};

const limits = {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100};

it.each(codecHandlerRetentionUserCases)("handler retention: $name", ({name, source}) => {
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(reference.reference.platform).toBe("macOS-26.4.1-arm64-arm-64bit-Mach-O");
  expect(reference.reference.byteorder).toBe("little");
  const row = reference.rows.find(candidate => candidate.name === name)!;
  expect(row.source).toBe(source);
  expect(row.status).toBe(0);
  expect(row.stderr).toBe("");
  let output = "";
  const session = new PythonSession({
    limits, hashSeed: [1n, 2n], input: {readLine() {return "continue\n";}},
    output: {write(text) {output += text;}, flush() {}},
  });
  expect(session.exec(source).status, output).toBe("ok");
  expect(output).toBe(row.stdout);
});

it.each(codecHandlerRetentionUserCases)("terminal cancellation during handler position: $name", ({source}) => {
  for (const throws of [false, true]) {
    const controller = new AbortController();
    let reads = 0, writes = 0;
    const session = new PythonSession({
      limits, hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() {
        reads++;
        controller.abort();
        if (throws) throw new Error("input service failure");
        return "continue\n";
      }},
      output: {write() {writes++;}, flush() {}},
    });
    expect(session.exec(source)).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(reads).toBe(1);
    expect(writes).toBe(0);
    expect(session.exec(source)).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(reads).toBe(1);
    expect(writes).toBe(0);
  }
});
