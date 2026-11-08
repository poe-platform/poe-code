import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseWav, serializeWav, wavAst, probeWavSource, probeWavStream } from "./containers/adapters.js";
import { rawAudioAsts } from "./containers/raw-audio.js";

// Native FFmpeg: 4096 mono PCM16 samples ((i * 331) % 60001) - 30000,
// encoded with -c:a g726 -b:a bits*8000. Hashes cover native decoded PCM16.
const fixtures = [
  [2, "e236ae2f1e567de3fe09d64d0972ecde10b9cc002af26e48e82c0b61a70f6634"],
  [3, "910df42fb3e1a0f51b15be482fdaef66aaccf7dd57d7db5f36021892227cac38"],
  [4, "2c8cc229e99f2773759900b1b78fd2e3d582232083839266bd839332287eeb46"],
  [5, "56464cea71a5287df459ee1424781e96467ea0170d43119fdb48f859c8164751"],
] as const;
for (const [bits, hash] of fixtures) {
  const input = readFileSync(new URL(`./fixtures/g726-${bits}.wav`, import.meta.url));
  it(`decodes ${bits}-bit G.726 WAV to native PCM`, () => {
    const doc = parseWav(input);
    assert.equal(doc.duration, 4096);
    const pcm = rawAudioAsts().find(plugin => plugin.id === "s16le")!.serialize(doc);
    assert.equal(pcm.length, 8192);
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    assert.throws(() => parseWav(input, { limits: { maxMemoryBytes: 1 } }), /limit/i);
  });
  it(`probes and copies ${bits}-bit G.726 WAV without losing encoded bytes`, async () => {
    const options = { showPackets: true, maxSize: 11 };
    const probes = [await wavAst().probe!(input, options),
      await probeWavSource({ size: input.length, async read(offset, length) { return input.subarray(offset, offset + length); } }, options),
      await probeWavStream((async function* () { yield input; })(), options)];
    for (const probe of probes) {
      assert.equal(probe.streams[0]!.codec_name, "adpcm_g726");
      assert.equal(Number(probe.streams[0]!.duration_ts), 4096);
      const packets = Array.from(probe.packets!);
      assert.equal(packets.reduce((n, p) => n + p.duration!, 0), 4096);
      assert.equal(packets.reduce((n, p) => n + Number(p.size), 0), 4096 * bits / 8);
      assert.ok(packets.every(p => Number.isInteger(Number(p.pos)) && Number.isInteger(Number(p.size))));
    }
    const doc = parseWav(input, { decodeAudio: false, maxSize: 11 });
    assert.equal(doc.tracks[0]!.decodedAudio, undefined);
    const copy = serializeWav(doc, { audioCodec: "copy" });
    const pcm = rawAudioAsts().find(plugin => plugin.id === "s16le")!.serialize(parseWav(copy));
    assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
  });
}
it("rejects unsupported G.726 WAV widths and channels", () => {
  const input = readFileSync(new URL("./fixtures/g726-4.wav", import.meta.url));
  input.writeUInt16LE(6, 34);
  assert.throws(() => parseWav(input), /sample width/);
  input.writeUInt16LE(4, 34);
  input.writeUInt16LE(2, 22);
  assert.throws(() => parseWav(input), /mono/);
});
