import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { nistSphereAst } from "./containers/nistsphere.js";

const fixture = readFileSync(new URL("./fixtures/nist-little.sph", import.meta.url));

it("keeps NIST packet positions relative to a sliced file and metadata values intact", () => {
  const bytes = Buffer.concat([Buffer.alloc(19), fixture]).subarray(19);
  const ast = nistSphereAst();
  const doc = ast.parse(bytes);
  assert.deepEqual(doc.metadata, { custom: { speaker_id: "Ada" } });
  assert.deepEqual(ast.probe(bytes).format.tags, { speaker_id: "Ada" });
  assert.deepEqual(Array.from(doc.tracks[0]!.decodedAudio!.channelData[0]!),
    [-12345, 0, 32767, 157].map(value => value / 32768));
  assert.deepEqual(ast.probe(bytes, { showPackets: true }).packets?.map(packet =>
    [packet.pos, packet.pts, packet.size, packet.duration]), [["1024", 0, "16", 4]]);
});

for (const [before, after] of [
  ["   1024", "   4096"],
  ["   1024", "     16"],
  ["end_head", "bad_head"],
  ["sample_coding -s3 pcm", "sample_coding -s3 abc"],
  ["sample_byte_format -s2 01", "sample_byte_format -s2 11"],
  ["sample_n_bytes -i 2", "sample_n_bytes -i 4"],
  ["channel_count -i 2", "channel_count -i 0"],
  ["sample_rate -i 8000", "sample_rate -i    0"],
  ["sample_count -i 4", "sample_count -i x"],
  ["speaker_id -s3 Ada", "speaker_id -s9 Ada"]
]) {
  it(`rejects invalid NIST field ${after}`, () => {
    const bytes = Buffer.from(fixture);
    bytes.write(after!, bytes.indexOf(before!));
    for (const decodeAudio of [true, false]) {
      assert.throws(() => nistSphereAst().parse(bytes, { decodeAudio }));
    }
  });
}

it("enforces NIST input, header memory, decoded memory, duration and packet limits", () => {
  for (const limits of [
    { maxInputBytes: 1039 }, { maxMemoryBytes: 1023 }, { maxMemoryBytes: 2048 },
    { maxDurationSeconds: 0.0001 }, { maxSamplesPerTrack: 0 }, { maxStreams: 0 }
  ]) assert.throws(() => nistSphereAst().parse(fixture, { limits }), /Resource limit exceeded/);
  assert.equal(nistSphereAst().parse(fixture, { decodeAudio: false, limits: { maxMemoryBytes: 2048 } })
    .tracks[0]!.decodedAudio, undefined);
});
