import {expect, it} from "vitest";
import {PythonSession} from "./index.js";
import {codecNativeArgumentMatrixCases} from "./codec-native-argument-matrix-cases.js";
import reference from "./runtime/__snapshots__/codec-native-argument-matrix-3.14.7.json";

it("attributes codec warnings to the defining code after a later session call", () => {
  const warnings: {filename: string; line?: number}[] = [];
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    warning(warning) {
      expect(Object.isFrozen(warning)).toBe(true);
      expect(Object.isFrozen(warning.position)).toBe(true);
      warnings.push({filename: warning.filename, line: warning.position?.line});
    }
  });
  expect(session.exec("import _codecs\nclass Order:\n    def __index__(self):\n        return True\ndef encode():\n    return _codecs.utf_16_encode('A', None, Order())\n", {filename: "encoder.py"}).status).toBe("ok");
  expect(session.exec("encode()", {filename: "caller.py"}).status).toBe("ok");
  expect(warnings).toEqual([{filename: "encoder.py", line: 6}]);
});

it.each(codecNativeArgumentMatrixCases)("native codec arguments: $name", ({name, source}) => {
  const row = reference.cases.find(row => row.name === name)!;
  expect(reference.reference.version.startsWith("3.14.7 ")).toBe(true);
  expect(reference.reference.unicode).toBe("16.0.0");
  expect(reference.reference.byteorder).toBe("little");
  expect(reference.reference.platform).toBe("darwin");
  expect(row).toMatchObject({source, status: 0});
  let output = "";
  const warnings: {category: string; message: string; filename: string; line?: number}[] = [];
  const session = new PythonSession({
    hashSeed: [1n, 2n],
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    output: {write(text) {output += text;}, flush() {}},
    warning(warning) {warnings.push({category: warning.category, message: warning.message, filename: warning.filename, line: warning.position?.line});}
  });
  const result = session.exec(source);
  expect(result.status).toBe("ok");
  expect(output).toBe(row.stdout);
  expect(warnings).toEqual(row.warnings);
});

it.each(codecNativeArgumentMatrixCases.flatMap(row => [false, true].map(throws => ({...row, throws}))))(
  "native codec arguments keep cancellation terminal: $name (throws=$throws)", ({source, throws}) => {
    const controller = new AbortController();
    let writes = 0;
    const session = new PythonSession({
      hashSeed: [1n, 2n], signal: controller.signal,
      limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
      output: {write() {
        writes++;
        controller.abort();
        if (throws) throw new Error("output failed after cancellation");
      }, flush() {}}
    });
    expect(session.exec(source)).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(session.exec("print('resumed')")).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
    expect(writes).toBe(1);
  }
);

it.each([false, true])("codec warning service cancellation stays terminal (throws=%s)", throws => {
  const controller = new AbortController();
  let warnings = 0;
  const session = new PythonSession({
    hashSeed: [1n, 2n], signal: controller.signal,
    limits: {maxSteps: 1000000, maxAllocatedBytes: 16000000, maxDepth: 100},
    warning() {
      warnings++;
      controller.abort();
      if (throws) throw new Error("warning service failed after cancellation");
    }
  });
  expect(session.exec("import _codecs\nclass Order:\n    def __index__(self):\n        return True\n_codecs.utf_16_encode('A', None, Order())\n")).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(session.exec("pass")).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(session.eval("1")).toMatchObject({status: "terminated", reason: "cancelled"});
  expect(warnings).toBe(1);
});
