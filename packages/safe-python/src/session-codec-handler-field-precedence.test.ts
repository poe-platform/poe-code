import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecHandlerFieldPrecedenceCases} from "./codec-handler-field-precedence-cases.js";
import reference from "./runtime/__snapshots__/codec-handler-field-precedence-3.14.7.json" with {type: "json"};

it.each(codecHandlerFieldPrecedenceCases)("handler field precedence: $name", ({name, source}) => {
  const expected = reference.cases.find(row => row.name === name)!;
  expect(expected.source).toBe(source);
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100}, hashSeed: [1n, 2n],
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source).status).toBe("ok");
  expect(output).toBe(expected.stdout);
});
