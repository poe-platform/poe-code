import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecResultDiagnosticByteCases} from "./codec-result-diagnostic-byte-cases.js";
import reference from "./runtime/__snapshots__/codec-result-diagnostic-bytes-3.14.7.json";

it.each(codecResultDiagnosticByteCases)("codec result diagnostic $name", ({name, source}) => {
  let output = "";
  const session = new PythonSession({hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    output: {write(text) {output += text;}, flush() {}}});
  const result = session.exec(source);
  let diagnostic: string | undefined;
  if (result.status === "exception") {
    session.globals.set("failure", result.exception);
    const message = session.eval("str(failure)");
    if (message.status === "ok") diagnostic = String(message.value.primitive);
  }
  expect(result.status, diagnostic).toBe("ok");
  expect(output).toBe(reference.cases.find(row => row.name === name)!.stdout);
});
