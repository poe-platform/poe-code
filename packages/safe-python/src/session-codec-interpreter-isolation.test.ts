import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecInterpreterIsolationCases} from "./codec-interpreter-isolation-cases.js";
import reference from "./runtime/__snapshots__/codec-interpreter-isolation-3.14.7.json" with {type: "json"};

it.each(codecInterpreterIsolationCases)("isolates $encoding caches, recovery handlers and pending bytes across cancellation", ({encoding, setup, resume, remove}) => {
  expect(reference.target).toMatchObject({unicode: "16.0.0", platform: "darwin", byteorder: "little"});
  expect(reference.target.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.cases.find(row => row.encoding === encoding)).toMatchObject({source: setup + resume + remove, stdout: "recovered\n", stderr: "", exitCode: 0});
  for (const mode of ["continue", "failure", "cancel-return", "cancel-throw"]) {
    const controller = new AbortController();
    let firstReads = 0, secondReads = 0, output = "";
    const first = new PythonSession({
      hashSeed: [1n, 2n],
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
      signal: controller.signal,
      input: {readLine() {
        firstReads++;
        if (mode.startsWith("cancel")) controller.abort();
        if (mode === "cancel-throw") throw new Error("input failed");
        if (mode === "failure") return "guest-failure\n";
        return "ready\n";
      }},
      output: {write() {}, flush() {}}
    });
    const second = new PythonSession({
      hashSeed: [3n, 4n],
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
      input: {readLine() {secondReads++; return "ready\n";}},
      output: {write(text) {output += text;}, flush() {}}
    });
    expect(first.exec(setup).status).toBe("ok");
    expect(second.exec(setup).status).toBe("ok");
    const result = first.exec(resume);
    expect(firstReads).toBe(1);
    if (mode.startsWith("cancel")) {
      expect(result).toMatchObject({status: "terminated", reason: "cancelled"});
      expect(first.exec(resume)).toMatchObject({status: "terminated", reason: "cancelled"});
      expect(firstReads).toBe(1);
    } else {
      expect(result.status).toBe(mode === "continue" ? "ok" : "exception");
      if (result.status === "exception") {
        first.globals.set("caught", result.exception);
        expect(first.exec("assert caught is failure\nassert decoder.getstate() == state").status).toBe("ok");
      }
      expect(first.exec(remove).status).toBe("ok");
    }
    expect(second.exec(resume).status).toBe("ok");
    expect(secondReads).toBe(1);
    expect(output).toBe("recovered\n");
    expect(second.exec(remove).status).toBe("ok");
  }
});
