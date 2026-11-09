import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseMp4 } from "./mp4.js";
import { rawAudioAsts } from "./containers/raw-audio.js";

const input = readFileSync(new URL("./fixtures/caf-alac-copy.mov", import.meta.url));

it("decodes native MOV ALAC packets including the eight-frame tail to exact PCM", () => {
  const doc = parseMp4(input);
  assert.deepEqual(doc.tracks[0]!.samples.map(sample => sample.duration), [4096, 4096, 8]);
  const pcm = rawAudioAsts().find(plugin => plugin.id === "s16le")!.serialize(doc);
  assert.equal(pcm.length, 32800);
  assert.equal(createHash("sha256").update(pcm).digest("hex"),
    "50d5595b384041baf4e0d17bef38434d327019e750cd522c87b3cf80a6fc41bf");
});

it("skips ALAC decoding when requested and accounts for decoded memory", () => {
  assert.equal(parseMp4(input, { decodeAudio: false }).tracks[0]!.decodedAudio, undefined);
  assert.throws(() => parseMp4(input, { limits: { maxMemoryBytes: 65536 } }), /maxMemoryBytes/);
});

it("rejects missing ALAC decoder configuration while allowing packet copying", () => {
  const bytes = Buffer.from(input);
  const config = bytes.lastIndexOf(Buffer.from("alac"));
  assert.ok(config > 0);
  bytes.write("free", config, "ascii");
  assert.throws(() => parseMp4(bytes), /Missing MOV ALAC decoder configuration/);
  assert.equal(parseMp4(bytes, { decodeAudio: false }).tracks[0]!.samples.length, 3);
});
