import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecMapAliasCases} from "./codec-map-alias-cases.js";
import evidence from "./runtime/__snapshots__/codec-map-alias-service-evidence.json";

it.each(codecMapAliasCases)("codec map and alias callbacks: $name", ({name, source}) => {
  let output = "", reads = 0;
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    input: {readLine() {reads++; return "service_alias_published\n";}},
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(source);
  let diagnostic: unknown;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const detail = session.eval("repr(failure)");
    if (detail.status === "ok") diagnostic = detail.value.primitive;
  }
  const row = evidence.cases.find(row => row.name === name)!;
  expect(row.source).toBe(source);
  expect(row.oracle.status, row.oracle.stderr).toBe(0);
  expect(result.status, String(diagnostic)).toBe("ok");
  expect(output).toBe(row.oracle.stdout);
  expect(reads).toBe(row.guest.reads);
});

it.each([false, true])("keeps alias publication cancellation terminal (input throws=%s)", throws => {
  const controller = new AbortController();
  let reads = 0, output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() {
      reads++;
      controller.abort();
      if (throws) throw Error("input cancelled");
      return "service_alias_published\n";
    }},
    output: {write(text) {output += text;}, flush() {}}
  });
  const source = codecMapAliasCases.find(row => row.name === "alias callback reads from the explicit input service before publishing")!.source;
  expect(session.exec(source)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(1);
  expect(output).toBe("");
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});
