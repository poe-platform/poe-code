import propertyDiagnostics from "./runtime/__snapshots__/property-diagnostics.json";
import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {propertyContractCases, codecPropertyServiceSource} from "./property-contract-cases.js";

it.each(propertyContractCases)("property contract: $name", ({source}) => {
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
});

it("runs codec annotation property callbacks through explicit text services", () => {
  const events: string[] = [];
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n], input: {readLine() {events.push("read"); return "property\n";}}, output: {write(text) {events.push(`write:${text}`);}, flush() {events.push("flush");}}});
  expect(session.exec(codecPropertyServiceSource).status).toBe("ok");
  expect(events).toEqual(["flush", "read", "write:property", "write:\n", "flush", "write:verified", "write:\n", "flush"]);
});

it.each(Array.from({length: 8}, (_, index) => index + 1))("keeps cancellation at property service boundary %i terminal", boundary => {
  const controller = new AbortController();
  const events: string[] = [];
  const record = (event: string) => {events.push(event); if (events.length === boundary) controller.abort();};
  const session = new PythonSession({limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n], signal: controller.signal, input: {readLine() {record("read"); return "property\n";}}, output: {write(text) {record(`write:${text}`);}, flush() {record("flush");}}});
  expect(session.exec(codecPropertyServiceSource)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(events).toEqual(["flush", "read", "write:property", "write:\n", "flush", "write:verified", "write:\n", "flush"].slice(0, boundary));
  expect(session.exec("print('later')")).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(events).toHaveLength(boundary);
});

it.each(propertyDiagnostics)("property diagnostic: $expression", ({expression, type, message}) => {
  const session = new PythonSession({limits: {maxSteps: 100000, maxAllocatedBytes: 4000000, maxDepth: 100}, hashSeed: [1n, 2n]});
  const result = session.exec(`try:\n    ${expression}\nexcept Exception as error:\n    assert type(error).__name__ == ${JSON.stringify(type)}\n    assert str(error) == ${JSON.stringify(message)}\nelse:\n    assert False`);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
});
