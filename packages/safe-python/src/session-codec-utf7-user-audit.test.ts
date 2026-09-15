import {expect, it} from "vitest";
import {setImmediate} from "node:timers/promises";
import {PythonSession} from "./index.js";
import {codecUtf7UserAuditCases, codecUtf7UserAuditServiceSource} from "./codec-utf7-user-audit-cases.js";
import reference from "./runtime/__snapshots__/codec-utf7-user-audit-3.14.7.json" with {type: "json"};

it.each(codecUtf7UserAuditCases)("UTF-7 user audit: $name", async ({name, source}) => {
  await setImmediate();
  expect(reference.target).toMatchObject({version: "3.14.7", unicode: "16.0.0", platform: "darwin", byteorder: "little"});
  const oracle = reference.cases.find(row => row.name === name)!;
  expect(oracle.source).toBe(source);
  expect(oracle.exitCode).toBe(0);
  expect(oracle.stderr).toBe("");
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 3000000, maxAllocatedBytes: 32000000, maxDepth: 100},
    hashSeed: [1n, 2n], output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source).status, output).toBe("ok");
  expect(output).toBe(oracle.stdout);
});

it.each(["continue", "abort-return", "abort-throw"])("UTF-7 recovery service: %s", mode => {
  const controller = new AbortController();
  let output = "", reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], signal: controller.signal,
    output: {write(text) {output += text;}, flush() {}},
    input: {readLine() {
      reads++;
      if (mode !== "continue") controller.abort();
      if (mode === "abort-throw") throw new Error("service failed after cancellation");
      return "ready\n";
    }}
  });
  expect(reference.service.source).toBe(codecUtf7UserAuditServiceSource);
  expect(reference.service.exitCode).toBe(0);
  expect(reference.service.stderr).toBe("");
  const result = session.exec(codecUtf7UserAuditServiceSource);
  expect(reads).toBe(1);
  if (mode === "continue") {
    expect(result.status).toBe("ok");
    expect(output).toBe(reference.service.stdout);
  } else {
    expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(output).toBe("");
    expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
  }
});
