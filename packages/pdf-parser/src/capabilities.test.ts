import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfCapabilities, getPdfCommandGate, PdfSyntaxError } from "./index.js";

test("local implementation evidence never qualifies dependent commands", () => {
  for (const command of ["pdfinfo", "pdftotext", "qpdf"] as const) {
    const gate = getPdfCommandGate(command);
    assert.equal(gate.qualified, false);
    assert.ok(gate.missing.length > 0);
    assert.ok(gate.missing.includes("consumerArtifacts"));
    for (const feature of gate.missing) assert.notEqual(pdfCapabilities[feature].status, "qualified");
  }
});

test("syntax, recovery, inspection, extraction and rewriting stay independent", () => {
  const info = getPdfCommandGate("pdfinfo").missing;
  const text = getPdfCommandGate("pdftotext").missing;
  const rewrite = getPdfCommandGate("qpdf").missing;
  assert.ok(info.includes("strictSyntax"));
  assert.ok(info.includes("recovery"));
  assert.ok(info.includes("objectInspection"));
  assert.ok(!info.includes("text"));
  assert.ok(text.includes("fonts"));
  assert.ok(text.includes("text"));
  assert.ok(text.includes("layout"));
  assert.ok(!text.includes("losslessRewriting"));
  assert.ok(rewrite.includes("losslessRewriting"));
  assert.equal(pdfCapabilities.losslessRewriting.status, "unsupported");
  assert.equal(pdfCapabilities.encryptedDocuments.status, "unsupported");
  assert.equal(pdfCapabilities.filteredIndexes.status, "unsupported");
});

test("gate results and evidence cannot be mutated to claim qualification", () => {
  assert.ok(Object.isFrozen(pdfCapabilities));
  for (const capability of Object.values(pdfCapabilities)) {
    assert.ok(Object.isFrozen(capability));
    assert.ok(capability.evidence.length > 0);
    assert.ok(capability.limitations.length > 0);
  }
  const gate = getPdfCommandGate("qpdf");
  assert.ok(Object.isFrozen(gate));
  assert.ok(Object.isFrozen(gate.missing));
  assert.equal(Reflect.set(gate, "qualified", true), false);
  assert.equal(getPdfCommandGate("qpdf").qualified, false);
});

test("gate validates runtime command names and propagates cancellation unchanged", () => {
  for (const invalid of ["", "PDFINFO", "toString", "__proto__", null, {}]) {
    assert.throws(() => getPdfCommandGate(invalid as "pdfinfo"),
      error => error instanceof PdfSyntaxError && error.code === "ARGUMENT");
  }
  for (const reason of [0, false, "cancel", new Error("cancel")]) {
    const controller = new AbortController();
    controller.abort(reason);
    assert.throws(() => getPdfCommandGate("pdfinfo", { signal: controller.signal }), error => error === reason);
  }
});

test("gate rejects non-string commands without invoking caller coercion", () => {
  let coercions = 0;
  const command = { [Symbol.toPrimitive]() { coercions++; return "pdfinfo"; } };
  for (const invalid of [command, new String("pdfinfo"), Symbol("pdfinfo")]) {
    assert.throws(() => getPdfCommandGate(invalid as "pdfinfo"),
      error => error instanceof PdfSyntaxError && error.code === "ARGUMENT");
  }
  assert.equal(coercions, 0);
});
