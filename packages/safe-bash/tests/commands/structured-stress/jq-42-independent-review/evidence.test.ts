import assert from "node:assert/strict";
import test from "node:test";
import { cases } from "./cases.mjs";
import { loadEvidence, transports } from "./evidence.mjs";
import { chunks, collector, quote } from "./harness.js";

test("review evidence preserves the original42 and complete 155/81 cohorts", () => {
  const evidence = loadEvidence();
  assert.equal(evidence.historical.filter((vector: { cohort: string }) => vector.cohort === "independent").length, 155);
  assert.equal(evidence.historical.filter((vector: { cohort: string }) => vector.cohort === "additive").length, 81);
  assert.equal(evidence.original.size, 42);
  assert.equal(evidence.independent.length, 20);
  assert.deepEqual(evidence.manifest.original42.reduce((counts: Record<string, number>, row: { classification: string }) => {
    counts[row.classification] = (counts[row.classification] ?? 0) + 1;
    return counts;
  }, {}), { "diagnostic-only": 12, "status/output difference": 30 });
});

test("independent specifications match frozen argv, files and exact input bytes", () => {
  const { independent } = loadEvidence();
  const specifications: { id: string; inputHex: string; argv?: string[]; files?: Record<string, string>; allBoundaries?: boolean; stages?: string[][] }[] = cases;
  for (const specification of specifications) {
    const vector = independent.find((candidate: { id: string }) => candidate.id === specification.id);
    assert.ok(vector);
    for (const field of ["inputHex", "argv", "files", "allBoundaries"] as const) assert.deepEqual(vector[field], specification[field]);
    if (specification.stages) {
      assert.ok(vector.stages);
      assert.deepEqual(vector.stages.map(stage => stage.argv), specification.stages);
    }
  }
});

test("every malformed/surrogate input boundary is explicit and byte preserving", async () => {
  const { independent } = loadEvidence();
  const boundaryVectors = independent.filter((vector: { allBoundaries?: boolean }) => vector.allBoundaries);
  assert.equal(boundaryVectors.length, 5);
  for (const vector of boundaryVectors) {
    const bytes = Buffer.from(vector.inputHex, "hex");
    const variants = transports(vector);
    assert.equal(variants.length, bytes.length + 1);
    for (const variant of variants) {
      const received = [];
      for await (const chunk of chunks(bytes, variant)) received.push(Buffer.from(chunk));
      assert.deepEqual(Buffer.concat(received), bytes);
      if (variant.startsWith("split:")) assert.equal(received[0]!.length, Number(variant.slice(6)));
      if (variant === "bytewise") assert.ok(received.every(chunk => chunk.length === 1));
    }
  }
});

test("review byte sinks retain invalid UTF8/NUL without decoding and enforce caps", async () => {
  const output = collector();
  const bytes = Buffer.from("00c180ff", "hex");
  await output.sink.write(bytes);
  bytes.fill(0);
  assert.equal(output.hex(), "00c180ff");
  await assert.rejects(output.sink.write(new Uint8Array(65536)), /byte cap/u);
  assert.equal(quote("a'b\n"), "'a'\\''b\n'");
});
