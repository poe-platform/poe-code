import { expect, it, vi } from "vitest";
import { executeTest262 } from "./execute.js";

const harness = new Map([
  ["assert.js", 'let harnessOrder=["assert"];'],
  ["sta.js", 'harnessOrder.push("sta");'],
  ["doneprintHandle.js", 'function $DONE(error){print(error?"Test262:AsyncTestFailure:"+error:"Test262:AsyncTestComplete")}'],
  ["extra.js", 'harnessOrder.push("extra");']
]);

it("executes each ordinary variant in a fresh realm with ordered harness files", async () => {
  const source = '/*---\nincludes: [extra.js]\n---*/\nif(harnessOrder.join(",")!=="assert,sta,extra")throw 1;let unique=1';
  expect(await executeTest262("example.js", source, { harness, timeoutMs: 1000 }))
    .toMatchObject({ kind: "test", results: [
      { mode: "sloppy", status: "passed" }, { mode: "strict", status: "passed" }
    ] });
});

it("keeps raw tests free of harness state", async () => {
  expect(await executeTest262("example.js", '/*---\nflags: [raw]\n---*/\nif(typeof harnessOrder!=="undefined")throw 1', { harness, timeoutMs: 1000 }))
    .toMatchObject({ kind: "test", results: [{ mode: "raw", status: "passed" }] });
});

it("does not reinterpret a missing harness as an expected guest error", async () => {
  const source = '/*---\nflags: [onlyStrict]\nincludes: [missing.js]\nnegative: {phase: runtime, type: ReferenceError}\n---*/\nmissing';
  expect(await executeTest262("example.js", source, { harness, timeoutMs: 1000 }))
    .toMatchObject({ kind: "test", results: [{ status: "failed", reason: "harness-error" }] });
});

it.each([
  ['$DONE()', "passed"],
  ['$DONE("failure")', "failed"],
  ['Promise.resolve().then(()=>$DONE())', "passed"],
  ['$DONE();throw new Error("after completion")', "failed"],
  ['$DONE();$DONE("later failure")', "failed"]
])("requires successful async completion for %s", async (body, status) => {
  const source = `/*---\nflags: [async, onlyStrict]\n---*/\n${body}`;
  expect(await executeTest262("example.js", source, { harness, timeoutMs: 1000 }))
    .toMatchObject({ kind: "test", results: [{ status }] });
});

it("times out async tests which never report completion", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const pending = executeTest262("example.js", '/*---\nflags: [async, onlyStrict]\n---*/\n0', { harness, timeoutMs: 10 });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ kind: "test", results: [{ status: "failed", reason: "timeout" }] });
  } finally { vi.useRealTimers(); }
});

it("reports unsupported modules and fixtures without counting passes", async () => {
  expect(await executeTest262("dep_FIXTURE.js", "export {}", { harness, timeoutMs: 1000 })).toEqual({ kind: "fixture" });
  expect(await executeTest262("example.js", '/*---\nflags: [module]\n---*/\nexport {}', { harness, timeoutMs: 1000 }))
    .toMatchObject({ kind: "test", results: [{ mode: "module", status: "unsupported" }] });
});
