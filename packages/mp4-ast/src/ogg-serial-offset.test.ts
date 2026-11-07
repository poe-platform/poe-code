import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { encodeWav, readOgg } from "@poe-code/audio-ast";
import { oggAst, parseWav } from "./containers/adapters.js";

for (const codec of ["opus", "vorbis", "flac"]) {
  it(`sets serial numbers on every encoded ${codec} page`, () => {
    const doc = parseWav(encodeWav({ sampleRate: 48000,
      channels: [Float64Array.from({ length: 2400 }, (_, i) => Math.sin(i * 0.1) * 0.4)] }));
    const bytes = oggAst().serialize(doc, { audioCodec: codec, serialOffset: 7 });
    assert.ok(readOgg(bytes).packets.every(packet => packet.serial === 7));
    assert.equal(oggAst().parse(bytes).tracks.length, 1);
  });
}

it("numbers multiplexed Opus streams consecutively", () => {
  const input = readFileSync(new URL("../../safe-bash-command-ffmpeg/src/fixtures/two-opus.ogg", import.meta.url));
  const doc = oggAst().parse(input, { decodeAudio: false });
  const bytes = oggAst().serialize(doc, { audioCodec: "copy", serialOffset: 7 });
  assert.deepEqual([...new Set(readOgg(bytes).packets.map(packet => packet.serial))], [7, 8]);
  assert.equal(oggAst().parse(bytes, { decodeAudio: false }).tracks.length, 2);
  for (const serialOffset of [-1, 2147483648, 1.5, NaN]) {
    assert.throws(() => oggAst().serialize(doc, { audioCodec: "copy", serialOffset }), /Invalid serial_offset/);
  }
});
