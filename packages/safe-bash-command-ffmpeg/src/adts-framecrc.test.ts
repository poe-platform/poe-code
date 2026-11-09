import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/adts-framecrc.aac", import.meta.url));

async function run(args: string[], bytes = input) {
  const volume = Volume.fromJSON({ "/in.aac": bytes });
  let stderr = "";
  const chunks: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/in.aac", ...args, "-"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); } },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(chunks).toString();
}

it("copies complete ADTS packets with the native packet clock and audio sample rate", async () => {
  const output = await run(["-c:a", "copy", "-f", "framecrc"]);
  // Native FFmpeg 7.0.2; compare packet metadata independently of the library version.
  assert.equal(output.split("\n").filter(line => !line.startsWith("#software:")).join("\n"), `#tb 0: 1/28224000
#media_type 0: audio
#codec_id 0: aac
#sample_rate 0: 8000
#channel_layout_name 0: mono
0,          0,          0,  3612672,      558, 0xd4def34a
0,    3612672,    3612672,  3612672,      538, 0x6de4265c
0,    7225344,    7225344,  3612672,      536, 0xec96123d
0,   10838016,   10838016,  3612672,      546, 0xdbbaeb56
0,   14450688,   14450688,  3612672,       12, 0x2ad005f6
`);
});

for (const protectedHeader of [false, true]) {
  it(`hashes original ADTS header bytes at 44.1 kHz, CRC protection=${protectedHeader}`, async () => {
    const original = input.subarray(0, 558);
    const packet = protectedHeader
      ? Buffer.concat([original.subarray(0, 7), Buffer.from([0x12, 0x34]), original.subarray(7)])
      : Buffer.from(original);
    packet[1] = protectedHeader ? 0xf8 : 0xf9; // MPEG-2; retain the source header verbatim.
    packet[2] = 0x50; // AAC-LC at 44100 Hz.
    packet[3] = (packet[3]! & 0xfc) | (packet.length >>> 11);
    packet[4] = (packet.length >>> 3) & 255;
    packet[5] = ((packet.length & 7) << 5) | (packet[5]! & 31);
    const output = await run(["-c:a", "copy", "-f", "framemd5"], packet);
    assert.ok(output.includes("#tb 0: 1/28224000\n"), output);
    assert.ok(output.includes("#sample_rate 0: 44100\n"), output);
    assert.deepEqual(output.trim().split("\n").at(-1)!.split(",").map(field => field.trim()),
      ["0", "0", "0", "655360", String(packet.length), createHash("md5").update(packet).digest("hex")]);
    const stream = await run(["-c:a", "copy", "-f", "hash"], packet);
    assert.equal(stream, `SHA256=${createHash("sha256").update(packet).digest("hex")}\n`);
  });
}

it("removes ADTS headers with aac_adtstoasc while retaining the demuxer clock", async () => {
  const output = await run(["-c:a", "copy", "-bsf:a", "null,aac_adtstoasc,null", "-f", "framecrc"]);
  assert.ok(output.includes("#tb 0: 1/28224000\n"), output);
  const rows = output.split("\n").filter(line => line && !line.startsWith("#"))
    .map(line => line.split(",").map(field => field.trim()));
  assert.deepEqual(rows, [
    ["0", "0", "0", "3612672", "551", "0x9060ee8e"],
    ["0", "3612672", "3612672", "3612672", "531", "0x96d12222"],
    ["0", "7225344", "7225344", "3612672", "529", "0xa2c60e43"],
    ["0", "10838016", "10838016", "3612672", "539", "0xe0b9e71b"],
    ["0", "14450688", "14450688", "3612672", "5", "0x03c001be"]
  ]);
});

it("keeps decoded PCM checksums on the audio sample clock", async () => {
  const output = await run(["-c:a", "pcm_s16le", "-f", "framecrc"]);
  assert.equal(output.split("\n").filter(line => !line.startsWith("#software:")).join("\n"), `#tb 0: 1/8000
#media_type 0: audio
#codec_id 0: pcm_s16le
#sample_rate 0: 8000
#channel_layout_name 0: mono
0,          0,          0,     1024,     2048, 0xdd6ac1d8
0,       1024,       1024,     1024,     2048, 0x8586cb78
0,       2048,       2048,     1024,     2048, 0xc782e168
0,       3072,       3072,     1024,     2048, 0x23b4f34d
0,       4096,       4096,     1024,     2048, 0x233212d6
`);
});
