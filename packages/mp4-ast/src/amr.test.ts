import assert from "node:assert/strict";
import { it } from "node:test";
import { amrAst } from "./containers/amr.js";

for (const [signature, sizes, rate] of [
  ["#!AMR\n", [13, 14, 16, 18, 20, 21, 27, 32, 6, 0, 0, 0, 0, 0, 0, 1], 8000],
  ["#!AMR-WB\n", [18, 24, 33, 37, 41, 47, 51, 59, 61, 6, 0, 0, 0, 0, 1, 1], 16000]
] as const) {
  const header = Buffer.from(signature);
  const packets = sizes.flatMap((size, type) => {
    if (!size) return [];
    const packet = Buffer.alloc(size, type);
    packet[0] = (type << 3) | 4;
    return [packet];
  });
  const bytes = Buffer.concat([header, ...packets]);
  it(`preserves every valid frame type and 20ms timestamps for ${signature.trim()}`, () => {
    const doc = amrAst().parse(bytes);
    const track = doc.tracks[0]!;
    assert.equal(track.timescale, rate);
    assert.deepEqual(track.samples.map(s => Buffer.from(s.data!)), packets);
    assert.deepEqual(track.samples.map(s => s.pts), packets.map((_, i) => i * rate / 50));
    assert.equal(doc.durationSeconds, packets.length / 50);
    assert.equal(amrAst().probe(bytes).streams[0]!.codec_name, rate === 8000 ? "amr_nb" : "amr_wb");
  });
  it(`rejects truncated and reserved frames for ${signature.trim()}`, () => {
    assert.throws(() => amrAst().parse(Buffer.concat([header, packets[0]!.subarray(0, -1)])), /Truncated AMR/);
    assert.throws(() => amrAst().parse(Buffer.concat([header, Buffer.from([10 << 3])])), /Invalid AMR/);
    assert.throws(() => amrAst().parse(Buffer.concat([header, Buffer.from([0x80])])), /Invalid AMR/);
  });
  it(`enforces packet and duration limits for ${signature.trim()}`, () => {
    assert.throws(() => amrAst().parse(bytes, { limits: { maxSamplesPerTrack: 1 } }));
    assert.throws(() => amrAst().parse(bytes, { limits: { maxDurationSeconds: 0.01 } }));
  });
}
it("does not detect partial or multichannel AMR signatures", () => {
  for (const signature of ["#!AMR", "#!AMR-WB", "#!AMR_MC1.0\n", "#!AMR-WB_MC1.0\n"]) {
    assert.equal(amrAst().detect(Buffer.from(signature)), false);
    assert.throws(() => amrAst().parse(Buffer.from(signature)), /Invalid AMR header/);
  }
});
