import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { cafAst } from "./containers/caf.js";
import { parseMp4 } from "./mp4.js";
import { MediaBudgetTracker } from "./types.js";
import { readFileSync } from "node:fs";

// Native ALAC MOV with three packets, including an eight-frame tail.
const alacMov = readFileSync(new URL("./fixtures/caf-alac-copy.mov", import.meta.url));

it("writes ALAC decoder configuration, variable packet sizes and the short tail to CAF", () => {
  const doc = parseMp4(alacMov, { decodeAudio: false });
  const output = cafAst().serialize(doc, { audioCodec: "copy" });
  const bytes = Buffer.from(output);
  assert.equal(bytes.toString("ascii", 28, 32), "alac");
  assert.equal(bytes.readUInt32BE(36), 0);
  assert.equal(bytes.readUInt32BE(40), 4096);
  const chunks = new Map<string, Buffer>();
  for (let offset = 8; offset < bytes.length;) {
    const size = Number(bytes.readBigInt64BE(offset + 4));
    chunks.set(bytes.toString("ascii", offset, offset + 4), bytes.subarray(offset + 12, offset + 12 + size));
    offset += 12 + size;
  }
  assert.equal(chunks.get("kuki")!.toString("hex"), "0000000c66726d61616c616300000024616c616300000000000010000010280a0e020000000040040003e80000001f40");
  const pakt = chunks.get("pakt")!;
  assert.equal(pakt.readBigInt64BE(0), 3n);
  assert.equal(pakt.readBigInt64BE(8), 8200n);
  assert.equal(pakt.readUInt32BE(16), 0);
  assert.equal(pakt.readUInt32BE(20), 4088);
  assert.equal(pakt.subarray(24).toString("hex"), "915bbb7c28");
  assert.deepEqual(chunks.get("data")!.subarray(4), Buffer.concat(doc.tracks[0]!.samples.map(s => s.data)));
  const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-f", "s16le", "-c:a", "pcm_s16le", "pipe:1"], { input: output });
  assert.equal(decoded.status, 0, decoded.stderr.toString());
  assert.equal(decoded.stdout.length, 32800);
  assert.equal(createHash("sha256").update(decoded.stdout).digest("hex"), "50d5595b384041baf4e0d17bef38434d327019e750cd522c87b3cf80a6fc41bf");
  assert.throws(() => cafAst().serialize(doc, { audioCodec: "copy", budget: new MediaBudgetTracker({ maxOutputBytes: output.length - 1 }) }), /limit/i);
  assert.equal(cafAst().serialize(doc, { audioCodec: "copy", budget: new MediaBudgetTracker({ maxOutputBytes: output.length }) }).length, output.length);
});

it("accepts a direct ALAC configuration and rejects missing configuration or invalid packets", () => {
  const doc = parseMp4(alacMov, { decodeAudio: false });
  const track = doc.tracks[0]!;
  const desc = track.codecDescriptions[0]!;
  const entry = Buffer.concat([desc.rawStsdEntryBytes!.subarray(0, 36), desc.rawStsdEntryBytes!.subarray(72, 108)]);
  entry.writeUInt32BE(entry.length, 0);
  entry.writeUInt16BE(0, 16);
  const direct = { ...doc, tracks: [{ ...track, codecDescriptions: [{ ...desc, rawStsdEntryBytes: entry }] }] };
  assert.deepEqual(cafAst().serialize(direct, { audioCodec: "copy" }), cafAst().serialize(doc, { audioCodec: "copy" }));
  assert.throws(() => cafAst().serialize({ ...doc, tracks: [{ ...track, codecDescriptions: [{ ...desc, rawStsdEntryBytes: undefined }] }] }, { audioCodec: "copy" }), /decoder configuration/);
  assert.throws(() => cafAst().serialize({ ...doc, tracks: [{ ...track, samples: [{ ...track.samples[0]!, duration: 4097 }] }] }, { audioCodec: "copy" }), /ALAC packet/);
});
