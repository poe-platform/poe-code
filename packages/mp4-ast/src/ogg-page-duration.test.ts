import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { encodeWav, readOgg } from "@poe-code/audio-ast";
import { oggAst, parseWav } from "./containers/adapters.js";

for (const codec of ["opus", "vorbis"]) {
  it(`groups encoded ${codec} packets by page duration without changing audio`, () => {
    const doc = parseWav(encodeWav({ sampleRate: 48000,
      channels: [Float64Array.from({ length: 12000 }, (_, i) => Math.sin(i * 0.1) * 0.4)] }));
    const plugin = oggAst();
    const short = readOgg(plugin.serialize(doc, { audioCodec: codec, pageDuration: 20000 }));
    const long = readOgg(plugin.serialize(doc, { audioCodec: codec, pageDuration: 1000000 }));
    assert.ok(short.nodes.length > long.nodes.length);
    assert.deepEqual(short.packets.map(packet => packet.data), long.packets.map(packet => packet.data));
    assert.equal(short.packets.at(-1)!.granule, long.packets.at(-1)!.granule);
  });
}

it("flushes at the lacing limit without joining or dropping whole packets", () => {
  const plugin = oggAst();
  const input = readFileSync(new URL("../../safe-bash-command-ffmpeg/src/fixtures/tone-opus.ogg", import.meta.url));
  const doc = plugin.parse(input, { decodeAudio: false });
  const track = doc.tracks[0]!;
  const data = new Uint8Array(255);
  data[0] = track.samples[0]!.data[0]!;
  const samples = Array.from({ length: 200 }, (_, index) => ({
    ...track.samples[0]!, data, size: data.length, pts: index * 960, dts: index * 960
  }));
  const output = readOgg(plugin.serialize({ ...doc, tracks: [{ ...track, samples }] },
    { audioCodec: "copy", pageDuration: 10000000 }));
  assert.equal(output.nodes.length, 4);
  assert.deepEqual(output.packets.slice(2).map(packet => packet.data), samples.map(sample => sample.data));
  assert.equal(output.nodes[2]!.fields!.granule, 127n * 960n);
  assert.equal(output.packets.at(-1)!.granule, 200n * 960n);
});
