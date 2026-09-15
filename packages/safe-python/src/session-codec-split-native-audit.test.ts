import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecSplitNativeAuditCases} from "./codec-split-native-audit-cases.js";
import reference from "./runtime/__snapshots__/codec-split-native-audit-3.14.7.json";

it.each(codecSplitNativeAuditCases)("native codec split audit: $name", ({name, source}) => {
  const expected = reference.cases.find(row => row.name === name)!;
  expect(expected.source).toBe(source);
  let output = "";
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source).status).toBe("ok");
  expect(output).toBe(expected.stdout);
});
