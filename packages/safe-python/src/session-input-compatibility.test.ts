import { expect, it } from "vitest";
import { PythonSession } from "./index.js";

const limits = { maxSteps: 2_000_000, maxAllocatedBytes: 16_000_000, maxDepth: 100 };

it.each([null, ""])("raises EOFError for an exhausted input service returning %j", line => {
  const events: string[] = [];
  const session = new PythonSession({ limits, hashSeed: [1n, 2n],
    input: { readLine() { events.push("read"); return line; } },
    output: { write(value) { events.push(value); }, flush() { events.push("flush"); } }
  });
  expect(session.exec("message='no exception'\ntry: input('prompt')\nexcept EOFError as e: message=e.args[0]")).toEqual({ status: "ok" });
  expect(session.eval("message")).toMatchObject({ status: "ok", value: { primitive: "EOF when reading a line" } });
  expect(events).toEqual(["prompt", "flush", "read"]);
});

it.each([["\n", ""], ["\r\n", "\r"], ["a\r\n", "a\r"], ["a\r", "a\r"], ["a", "a"]])("preserves noninteractive input line semantics for %j", (line, expected) => {
  const session = new PythonSession({ limits, hashSeed: [1n, 2n], input: { readLine: () => line }, output: { write() {}, flush() {} } });
  expect(session.eval("input()")).toMatchObject({ status: "ok", value: { primitive: expected } });
});

it("validates input arguments before acquiring services or converting the prompt", () => {
  const session = new PythonSession({ limits, hashSeed: [1n, 2n] });
  expect(session.exec("try: input(1, 2, prompt=3)\nexcept TypeError as e: message=e.args[0]")).toEqual({ status: "ok" });
  expect(session.eval("message")).toMatchObject({ status: "ok", value: { primitive: "input() takes no keyword arguments" } });
});
