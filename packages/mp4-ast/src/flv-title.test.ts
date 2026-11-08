import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseFlv, serializeFlv } from "./index.js";

// Native FFmpeg: testsrc2=s=64x48:r=5:d=2 + sine=f=880:r=44100:d=2,
// -c:v libx264 -bf 0 -threads 1 -c:a aac -metadata title=Lecture.
const fixture = new Uint8Array(readFileSync(new URL("./fixtures/title.flv", import.meta.url)));

it("reads the global title from native FLV script metadata", () => {
  assert.equal(parseFlv(fixture).metadata.title, "Lecture");
});

for (const title of ["Lecture", "講義 🎬", "", "x".repeat(65536)]) {
  it(`writes FLV title metadata (${title.length} characters)`, () => {
    const source = parseFlv(fixture);
    const bytes = serializeFlv({ ...source, metadata: { title } });
    assert.equal(parseFlv(bytes).metadata.title, title);
  });
}

it("does not invent a title for FLV without metadata", () => {
  const source = parseFlv(fixture);
  assert.equal(parseFlv(serializeFlv({ ...source, metadata: {} })).metadata.title, undefined);
});

it("honors an explicit FLV title override", () => {
  const bytes = serializeFlv(parseFlv(fixture), { metadata: { title: "Updated" } });
  assert.equal(parseFlv(bytes).metadata.title, "Updated");
});
