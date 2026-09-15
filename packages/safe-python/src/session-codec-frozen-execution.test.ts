import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecFrozenExecutionCases} from "./codec-frozen-execution-cases.js";

const limits = {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100};

const orderedServiceEvents = ["Codec", "StreamWriter", "StreamReader"].flatMap(name => [
  // print(flush=True) flushes once; input() flushes stdout again before reading.
  `write:${name}`, "write:\n", "flush", "flush", "read",
]);

it.each(orderedServiceEvents.map((event, index) => ({event, cancelAt: index + 1})))(
  "keeps frozen import cancellation terminal at service $cancelAt ($event)", ({cancelAt}) => {
    const controller = new AbortController();
    const events: string[] = [];
    const record = (event: string) => {
      events.push(event);
      if (events.length === cancelAt) controller.abort();
    };
    const session = new PythonSession({limits, hashSeed: [1n, 2n], signal: controller.signal,
      input: {readLine() {record("read"); return "annotation\n";}},
      output: {write(text) {record(`write:${text}`);}, flush() {record("flush");}}});
    const source = codecFrozenExecutionCases.find(test => test.name === "frozen class creation preserves ordered write flush and input services")!.source;
    expect(session.exec(source)).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(events).toEqual(orderedServiceEvents.slice(0, cancelAt));
    expect(session.exec("print('continued')")).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(events).toEqual(orderedServiceEvents.slice(0, cancelAt));
  },
);

it.each(codecFrozenExecutionCases)("frozen execution: $name", ({source, output}) => {
  let stdout = "";
  const session = new PythonSession({limits, hashSeed: [1n, 2n], input: {readLine: () => "annotation\n"},
    output: {write(text) {stdout += text;}, flush() {}}});
  const result = session.exec(source);
  let detail: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const diagnostic = session.eval("str(failure)");
    if (diagnostic.status === "ok") detail = String(diagnostic.value.primitive);
  }
  expect(result.status, detail).toBe("ok");
  expect(stdout).toBe(output);
  // The mutated base class and the imported module cannot leak to a new session.
  const isolated = new PythonSession({limits, hashSeed: [1n, 2n]});
  expect(isolated.exec(`
import codecs
import encodings.raw_unicode_escape as module
assert module.Codec.__bases__ == (codecs.Codec,)
assert module.Codec().encode('A') == (b'A', 1)
`)).toEqual({status: "ok"});
});

it.each([1, 2, 3])("keeps cancellation at frozen class callback %s terminal", cancelAt => {
  const controller = new AbortController();
  let reads = 0, stdout = "";
  const session = new PythonSession({limits, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() {reads++; if (reads === cancelAt) controller.abort(); return "annotation\n";}},
    output: {write(text) {stdout += text;}, flush() {}}});
  expect(session.exec(codecFrozenExecutionCases.at(-1)!.source)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(cancelAt);
  expect(stdout).toBe("");
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});

it.each([1, 2])("keeps cancellation in frozen base descriptor attempt %s terminal", cancelAt => {
  const controller = new AbortController();
  let reads = 0, stdout = "";
  const session = new PythonSession({limits, hashSeed: [1n, 2n], signal: controller.signal,
    input: {readLine() {reads++; if (reads === cancelAt) controller.abort(); return "annotation\n";}},
    output: {write(text) {stdout += text;}, flush() {}}});
  expect(session.exec(codecFrozenExecutionCases[0].source)).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(reads).toBe(cancelAt);
  expect(stdout).toBe("");
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
});
