import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import reference from "./runtime/__snapshots__/codec-unregister-protected-services.json";

it.each(["normal", "cancel-return", "cancel-throw"])("protected codec handler removal (%s)", mode => {
  expect(reference.provenance.startsWith("3.14.7 ")).toBe(true);
  expect(reference.provenance).toContain("\n16.0.0\n");
  expect(reference.oracle).toMatchObject({status: 0, stderr: ""});
  const controller = new AbortController();
  let output = "", reads = 0;
  const session = new PythonSession({
    hashSeed: [1n, 2n], signal: controller.signal,
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {
      reads++;
      if (mode !== "normal") {
        controller.abort();
        if (mode === "cancel-throw") throw new Error("adapter failed after cancellation");
      }
      return "continue\n";
    }},
    output: {write(text) {output += text;}, flush() {}}
  });
  const result = session.exec(reference.source);
  expect(reads).toBe(1);
  if (mode === "normal") expect(result).toEqual({status: "ok"});
  else {
    expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(session.exec("pass")).toBe(result);
    expect(session.eval("1")).toBe(result);
  }
  expect(output).toBe(mode === "normal" ? reference.oracle.stdout : reference.oracle.stdout.slice(0, -"continue\n".length));
});
