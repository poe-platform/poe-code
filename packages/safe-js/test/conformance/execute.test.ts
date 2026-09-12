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

it.each([
  ['Promise.reject(42);$DONE()', "failed"],
  ['Promise.resolve().then(()=>{throw 42});$DONE()', "failed"],
  ['Promise.reject(42).catch(()=>{});$DONE()', "passed"],
  ['$DONE();$DONE()', "failed"]
])("accounts for every async signal and unhandled rejection: %s", async (body, status) => {
  expect(await executeTest262("async.js", `/*---\nflags: [async, onlyStrict]\n---*/\n${body}`, { harness, timeoutMs: 1000 }))
    .toMatchObject({ kind: "test", results: [{ status }] });
});

it.each([
  ["includes: [agent.js]", "agent"],
  ["features: [SharedArrayBuffer]", "shared-memory"],
  ["features: [IsHTMLDDA]", "IsHTMLDDA"]
])("accounts for unqualified capability requirements: %s", async (metadata, reason) => {
  expect(await executeTest262("capability.js", `/*---\nflags: [onlyStrict]\n${metadata}\n---*/\n0`, { harness, timeoutMs: 1000 }))
    .toMatchObject({ kind: "test", results: [{ status: "unsupported", reason }] });
});

it("recognizes an early error before evaluation and keeps its passing control", async () => {
  const negative = '/*---\nflags: [onlyStrict]\nnegative: {phase: parse, type: SyntaxError}\n---*/\nthrow 42;let duplicate;let duplicate;';
  expect(await executeTest262("early.js", negative, { harness, timeoutMs: 1000 }))
    .toMatchObject({ results: [{ status: "passed" }] });
  expect(await executeTest262("control.js", '/*---\nflags: [onlyStrict]\n---*/\nlet first;let second;', { harness, timeoutMs: 1000 }))
    .toMatchObject({ results: [{ status: "passed" }] });
});

it.each([
  ['$DONE();Promise.resolve().then(()=>Promise.resolve().then(()=>{throw 42}))', "failed", "unhandled-rejection"],
  ['$DONE();$262.createRealm().evalScript("Promise.reject(42)")', "failed", "unhandled-rejection"],
  ['try{$262.gc()}catch(error){};$DONE()', "unsupported", "gc"],
  ['$262.createRealm().evalScript("try{$262.gc()}catch(error){}");$DONE()', "unsupported", "gc"]
])("accounts for late jobs and child realm capability requirements: %s", async (body, status, reason) => {
  expect(await executeTest262("async.js", `/*---\nflags: [async, onlyStrict]\n---*/\n${body}`, { harness, timeoutMs: 1000 }))
    .toMatchObject({ results: [{ status, reason }] });
});

it("requires DONE for runtime-negative async tests", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const pending = executeTest262("negative.js", '/*---\nflags: [async, onlyStrict]\nnegative: {phase: runtime, type: TypeError}\n---*/\nthrow new TypeError()', { harness, timeoutMs: 10 });
    await vi.runAllTimersAsync();
    expect(await pending).toMatchObject({ results: [{ status: "failed", reason: "timeout" }] });
  } finally { vi.useRealTimers(); }
});

it("keeps raw module parsing unqualified even when script parsing would pass", async () => {
  expect(await executeTest262("raw-module.js", '/*---\nflags: [raw, module]\n---*/\n0', { harness, timeoutMs: 1000 }))
    .toMatchObject({ results: [{ mode: "raw", status: "unsupported", reason: "module" }] });
});

it("executes only an explicitly enumerated worker mode and rejects invented modes", async () => {
  expect(await executeTest262("selected.js", '0', { harness, timeoutMs: 1000, mode: "strict" }))
    .toMatchObject({ results: [{ mode: "strict", status: "passed" }] });
  await expect(executeTest262("selected.js", '/*---\nflags: [noStrict]\n---*/\n0', { harness, timeoutMs: 1000, mode: "strict" }))
    .rejects.toThrow("not enumerated");
});

it("does not qualify an errored fixture import through an absent loader's matching Error", async () => {
  // Pinned Test262 import-errored-module.js checks Error twice; its fixture throws Error("boom").
  const source = '/*---\nflags: [async]\nfeatures: [dynamic-import]\n---*/\n' +
    'async function check(){try{await import("./import-errored-module_FIXTURE.js");throw 42}catch(error){if(!(error instanceof Error))throw error}}' +
    'check().then(check).then(()=>$DONE(),$DONE);';
  expect(await executeTest262("import-errored-module.js", source, { harness, timeoutMs: 1000 }))
    .toMatchObject({ results: [
      { mode: "sloppy", status: "unsupported", reason: "module" },
      { mode: "strict", status: "unsupported", reason: "module" }
    ] });
});

it.each(["dynamic-import", "import-defer", "source-phase-imports", "source-phase-imports-module-source"])(
  "keeps %s runtime requirements unqualified while preserving parse-negative evidence", async feature => {
    expect(await executeTest262("import.js", `/*---\nfeatures: [${feature}]\nflags: [raw]\n---*/\n0`, { harness, timeoutMs: 1000 }))
      .toMatchObject({ results: [{ mode: "raw", status: "unsupported", reason: "module" }] });
    expect(await executeTest262("import.js", `/*---\nfeatures: [${feature}]\nflags: [onlyStrict]\nnegative: {phase: runtime, type: TypeError}\n---*/\nthrow new TypeError()`, { harness, timeoutMs: 1000 }))
      .toMatchObject({ results: [{ status: "unsupported", reason: "module" }] });
    expect(await executeTest262("import.js", `/*---\nfeatures: [${feature}]\nflags: [onlyStrict]\nnegative: {phase: parse, type: SyntaxError}\n---*/\nimport();`, { harness, timeoutMs: 1000 }))
      .toMatchObject({ results: [{ status: "passed" }] });
  }
);

it.each([
  ['if (1 + 1 !== 2) throw new Error("wrong value")', "passed", undefined],
  ['if (1 + 1 !== 3) throw new Error("wrong value")', "failed", "unexpected-throw"],
  ['$DONE()', "passed", undefined],
  ['$DONE("wrong value")', "failed", "async-failure"],
  ['Promise.reject(42);$DONE()', "failed", "unhandled-rejection"]
])("detects deliberately wrong results with an exact disposition: %s", async (body, status, reason) => {
  const flags = body.includes("$DONE") ? "async, onlyStrict" : "onlyStrict";
  const result = await executeTest262("oracle.js", `/*---\nflags: [${flags}]\n---*/\n${body}`, { harness, timeoutMs: 1000 });
  expect(result).toMatchObject({ results: [{ status, ...(reason ? { reason } : {}) }] });
});

it.each(["CanBlockIsFalse", "CanBlockIsTrue"])("accounts for %s as a host blocking-mode boundary", async flag => {
  expect(await executeTest262("blocking.js", `/*---\nflags: [onlyStrict, ${flag}]\n---*/\nthrow 42`, { harness, timeoutMs: 1000 }))
    .toMatchObject({ results: [{ status: "unsupported", reason: "blocking-mode" }] });
});

it("keeps resource-policy exhaustion distinct from a matching guest negative", async () => {
  expect(await executeTest262("budget.js", '/*---\nflags: [raw]\nnegative: {phase: runtime, type: Error}\n---*/\nwhile(true){}',
    { harness, timeoutMs: 1000, budget: { maxSteps: 10 } }))
    .toMatchObject({ results: [{ status: "failed", reason: "host-error", detail: { code: "budgetExceeded", budget: "steps" } }] });
  // Realm initialization itself consumes this intentionally tiny cap.
  expect(await executeTest262("budget-control.js", '/*---\nflags: [raw]\n---*/\n0',
    { harness, timeoutMs: 1000, budget: { maxSteps: 10 } }))
    .toMatchObject({ results: [{ status: "failed", reason: "host-error", detail: { code: "budgetExceeded", budget: "steps" } }] });
});

it("reports an errored harness include separately from the fixture negative", async () => {
  const erroredHarness = new Map(harness).set("extra.js", "throw new TypeError('harness failure')");
  expect(await executeTest262("harness.js", '/*---\nflags: [onlyStrict]\nincludes: [extra.js]\nnegative: {phase: runtime, type: TypeError}\n---*/\nthrow new TypeError()',
    { harness: erroredHarness, timeoutMs: 1000 }))
    .toMatchObject({ results: [{ status: "failed", reason: "harness-error", detail: { include: "extra.js", phase: "runtime", type: "TypeError" } }] });
});

it("honors the pinned print completion protocol for trusted raw async fixtures", async () => {
  expect(await executeTest262("raw-async.js", '/*---\nflags: [raw, async]\n---*/\nprint("Test262:AsyncTestComplete")', { harness, timeoutMs: 1000 }))
    .toEqual({ kind: "test", results: [{ mode: "raw", status: "passed" }] });
});
