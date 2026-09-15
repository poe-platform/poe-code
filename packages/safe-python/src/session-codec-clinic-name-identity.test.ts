import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecClinicNameIdentityCases} from "./codec-clinic-name-identity-cases.js";
import reference from "./runtime/__snapshots__/codec-clinic-name-identity-3.14.7.json";

it.each(codecClinicNameIdentityCases)("native codec keyword identity: $name", ({name, source}) => {
  let output = "", reads = 0;
  const session = new PythonSession({hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    input: {readLine() {reads++; return "continue\n";}},
    output: {write(text) {output += text;}, flush() {}}});
  expect(session.exec(source).status).toBe("ok");
  expect(output).toBe(reference.cases.find(row => row.name === name)!.stdout);
  expect(reads).toBe(name.endsWith("raise") ? 1 : 0);
});

it.each(codecClinicNameIdentityCases.filter(row => row.name.endsWith("raise")))("native codec keyword cancellation: $name", ({source}) => {
  for (const throws of [false, true]) {
    const controller = new AbortController();
    let reads = 0, output = "";
    const session = new PythonSession({hashSeed: [1n, 2n], signal: controller.signal,
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
      input: {readLine() {reads++; controller.abort(); if (throws) throw Error("service failure"); return "continue\n";}},
      output: {write(text) {output += text;}, flush() {}}});
    const result = session.exec(source);
    expect(result).toEqual({status: "terminated", reason: "cancelled", message: "execution cancelled"});
    expect(session.eval("1")).toBe(result);
    expect(reads).toBe(1);
    expect(output).toBe("");
  }
});
