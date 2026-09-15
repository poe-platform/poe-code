import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecUtf7ChainedInputCases} from "./codec-utf7-chained-input-cases.js";
import reference from "./runtime/__snapshots__/codec-utf7-chained-input-3.14.7.json" with {type: "json"};

it.each(codecUtf7ChainedInputCases)("UTF-7 chained input: $name", ({name, source}) => {
  expect(reference.target.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.target).toMatchObject({unicode: "16.0.0", platform: "darwin", byteorder: "little"});
  const oracle = reference.cases.find(row => row.name === name)!;
  expect(oracle.source).toBe(source);
  expect(oracle.exitCode).toBe(0);
  expect(oracle.stderr).toBe("");
  let output = "";
  const session = new PythonSession({
    limits: {maxSteps: 500000, maxAllocatedBytes: 8000000, maxDepth: 100},
    hashSeed: [1n, 2n], output: {write(text) {output += text;}, flush() {}}
  });
  expect(session.exec(source).status, output).toBe("ok");
  expect(output).toBe(oracle.stdout);
});
