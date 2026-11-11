import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { flacAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

function wav(count: number): Buffer {
  const bytes = Buffer.alloc(44 + count * 4);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36);
  bytes.writeUInt32LE(count * 4, 40);
  for (let i = 0; i < count; i++) {
    bytes.writeInt16LE((i % 16) * 751 - 6000, 44 + i * 4);
    bytes.writeInt16LE(8311 - 632 * (i % 16), 46 + i * 4);
  }
  return bytes;
}

async function run(input: Buffer, args: string[], target = "-"): Promise<Buffer> {
  const volume = Volume.fromJSON({ "/in.wav": input });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.wav", "-bitexact", "-c:a", "flac", ...args, target],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); } },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(stderr, "");
  return target === "-" ? Buffer.concat(chunks) : volume.readFileSync(target) as Buffer;
}

for (const format of ["framehash", "framemd5", "framecrc"]) {
  for (const count of [16, 65]) for (const target of ["-", "/out.txt"]) {
    it(`reports real FLAC packets and STREAMINFO in ${format}, samples=${count}, target=${target}`, async () => {
      const input = wav(count);
      const settings = count === 16 ? [] : ["-frame_size", "32", "-compression_level", "0"];
      const encoded = await run(input, [...settings, "-f", "flac"]);
      const track = flacAst().parse(encoded, { decodeAudio: false }).tracks[0]!;
      const digest = (bytes: Uint8Array): string => {
        if (format !== "framecrc") return createHash(format === "framemd5" ? "md5" : "sha256").update(bytes).digest("hex");
        let a = 0, b = 0;
        for (const byte of bytes) { a = (a + byte) % 65521; b = (b + a) % 65521; }
        return `0x${((b * 65536 + a) >>> 0).toString(16).padStart(8, "0")}`;
      };
      // STREAMINFO describes the actual encoder bytes; compression choices can differ from libavcodec.
      const final = Buffer.from(encoded.subarray(8, 42));
      final.writeUIntBE(Math.min(...track.samples.map(packet => packet.data.length)), 4, 3);
      final.writeUIntBE(Math.max(...track.samples.map(packet => packet.data.length)), 7, 3);
      const initial = Buffer.from(final);
      initial.fill(0, 4, 10); initial.fill(0, 14);
      initial[13] = initial[13]! & 0xf0;
      initial.writeUIntBE(24 + Math.ceil(33 * initial.readUInt16BE(0) / 8), 7, 3);
      const output = (await run(input, [...settings, "-f", format], target)).toString();
      assert.ok(output.includes(format === "framecrc"
        ? `#extradata 0:       34, ${digest(initial)}\n`
        : `#extradata 0,                              34, ${digest(initial)}\n`), output);
      assert.ok(output.includes("#tb 0: 1/8000\n#media_type 0: audio\n#codec_id 0: flac\n#sample_rate 0: 8000\n#channel_layout_name 0: stereo\n"));
      const rows = output.split("\n").filter(line => line && !line.startsWith("#"))
        .map(line => line.split(",").map(field => field.trim()));
      assert.deepEqual(rows, [
        ...track.samples.map(packet => ["0", String(packet.dts), String(packet.pts), String(packet.duration), String(packet.data.length), digest(packet.data)]),
        ["0", String(count), String(count), "0", "0", digest(new Uint8Array()), "S=1", "34", ...(format === "framecrc" ? [] : [digest(final)])]
      ]);
      const streamhash = (await run(input, [...settings, "-f", "streamhash"])).toString();
      assert.equal(streamhash, `0,a,SHA256=${createHash("sha256").update(Buffer.concat(track.samples.map(packet => packet.data))).digest("hex")}\n`);
    });
  }
}

it("omits FLAC side-data hashes in version 1 while retaining the flush packet", async () => {
  const output = (await run(wav(16), ["-f", "framehash", "-format_version", "1"])).toString();
  assert.ok(output.startsWith("#format: frame checksums\n#version: 1\n"));
  assert.equal(output.includes("S=1"), false);
  const rows = output.trim().split("\n").filter(line => !line.startsWith("#"));
  assert.equal(rows.length, 2);
  assert.equal(rows[1]!.split(",")[4]!.trim(), "0");
});

it("interleaves mapped FLAC packets and flush records with independently selected PCM", async () => {
  const output = (await run(wav(16), ["-map", "0:a", "-map", "0:a", "-map", "0:a",
    "-c:a:0", "pcm_s16le", "-c:a:1", "flac", "-c:a:2", "flac", "-f", "framehash"])).toString();
  const rows = output.trim().split("\n").filter(line => !line.startsWith("#"))
    .map(line => line.split(",").map(field => field.trim()));
  assert.deepEqual(rows.map(row => [row[0], row[1], row[3], row[6]]), [
    ["0", "0", "16", undefined], ["1", "0", "16", undefined], ["2", "0", "16", undefined],
    ["1", "16", "0", "S=1"], ["2", "16", "0", "S=1"]
  ]);
  assert.notEqual(rows[0]![5], rows[1]![5]);
  assert.equal(rows[1]![5], rows[2]![5]);
  assert.equal(rows[3]![8], rows[4]![8]);
  assert.equal(output.includes("#extradata 0,"), false);
  assert.ok(output.includes("#extradata 1,"));
  assert.ok(output.includes("#extradata 2,"));
});

it("matches native initial STREAMINFO with the same FLAC block size and preserves shifted timestamps", async () => {
  const output = (await run(wav(16), ["-af", "asetpts=PTS+800", "-frame_size", "576", "-f", "framehash"])).toString();
  // FFmpeg 7.0.2, stereo PCM16 at 8 kHz, 576 samples per encoder block.
  assert.ok(output.includes("#extradata 0,                              34, e1c40ef4ace39088e5ba7b5676a10e641f1c107a0cb02e067c7aff803bd51a6e\n"));
  const rows = output.trim().split("\n").filter(line => !line.startsWith("#"))
    .map(line => line.split(",").map(field => field.trim()));
  assert.deepEqual(rows.map(row => row.slice(1, 4)), [["800", "800", "16"], ["816", "816", "0"]]);
});
