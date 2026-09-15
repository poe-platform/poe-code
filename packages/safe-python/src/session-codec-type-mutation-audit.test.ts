import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecTypeMutationAuditCases, codecTypeMutationCancellationCases} from "./codec-type-mutation-audit-cases.js";
import reference from "./runtime/__snapshots__/codec-type-mutation-audit-3.14.7.json";

it.each(codecTypeMutationAuditCases)("codec type mutation: $name", ({name, source}) => {
  const expected = reference.cases.find(row => row.name === name)!;
  expect(source).toBe(expected.source);
  let stdout = "";
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], output: {write(text) {stdout += text;}, flush() {}}});
  const result = session.exec(source);
  let detail: unknown;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const message = session.eval("str(failure)");
    if (message.status === "ok") detail = message.value.primitive;
  }
  expect(result.status, String(detail)).toBe("ok");
  expect(stdout).toBe(expected.stdout);
});

it.each(codecTypeMutationCancellationCases)("keeps $operation cancellation terminal at equality $stage (throws=$throws)", ({source, throws}) => {
  const controller = new AbortController();
  let reads = 0;
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    hashSeed: [1n, 2n], signal: controller.signal, output: {write() {}, flush() {}}, input: {readLine() {
      reads++;
      controller.abort();
      if (throws) throw Error("service failed after cancellation");
      return "ready\n";
    }}});
  expect(session.exec(source)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
});
