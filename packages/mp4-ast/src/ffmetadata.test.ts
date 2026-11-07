import assert from "node:assert/strict";
import { it } from "node:test";
import { parseFfmetadata, serializeFfmetadata } from "./index.js";

it("defaults each FFmetadata chapter to nanoseconds while honoring explicit time bases", () => {
  const document = parseFfmetadata(new TextEncoder().encode([
    ";FFMETADATA1",
    "[CHAPTER]", "START=0", "END=250000000", "title=Default",
    "[CHAPTER]", "TIMEBASE=1/8000", "START=2000", "END=4000", "title=Explicit",
    "[CHAPTER]", "START=500000000", "END=750000000", "title=Reset",
    ""
  ].join("\n")));
  assert.deepEqual(document.chapters, [
    { id: 0, timeBase: { numerator: 1, denominator: 1_000_000_000 }, startTimeSeconds: 0, endTimeSeconds: 0.25, title: "Default" },
    { id: 1, timeBase: { numerator: 1, denominator: 8000 }, startTimeSeconds: 0.25, endTimeSeconds: 0.5, title: "Explicit" },
    { id: 2, timeBase: { numerator: 1, denominator: 1_000_000_000 }, startTimeSeconds: 0.5, endTimeSeconds: 0.75, title: "Reset" }
  ]);
  assert.equal(document.durationSeconds, 0.75);
  assert.deepEqual(parseFfmetadata(serializeFfmetadata(document)).chapters, document.chapters);
});
