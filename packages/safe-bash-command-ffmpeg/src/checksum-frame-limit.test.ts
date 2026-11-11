import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const pcm = Buffer.alloc(1100 * 4);
for (let i = 0; i < 1100; i++) {
  pcm.writeInt16LE(i * 101 % 30001 - 15000, i * 4);
  pcm.writeInt16LE(10000 - i * 53 % 20001, i * 4 + 2);
}
const input = encodeWav({ sampleRate: 8000, channels: [0, 1].map(channel =>
  Float64Array.from({ length: 1100 }, (_, i) => pcm.readInt16LE(i * 4 + channel * 2) / 32768)) }, { bitsPerSample: 16 });

// Native FFmpeg 7.0.2 stops both mapped streams at the limited stream's last packet.
for (const format of ["framehash", "streamhash"]) {
  for (const selector of ["a:0", "a:1"]) {
    for (const reframe of [false, true]) {
      for (const limit of [undefined, 1, 2, 3, 4]) {
        it(`${format} synchronizes mapped audio with ${selector} limit ${limit ?? "none"} (reframe=${reframe})`, async () => {
          const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
          let stdout = "", stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-v", "error", "-i", "/in.wav", "-bitexact", "-map", "0:a", "-map", "0:a",
              ...(reframe ? ["-filter:a:0", "asetnsamples=n=256:p=0"] : []),
              ...(limit === undefined ? [] : [`-frames:${selector}`, String(limit)]), "-f", format, "pipe:1"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
          const rows = stdout.split("\n").filter(line => line && !line.startsWith("#"));
          const frameSizes = [reframe ? 256 : 512, 512];
          const end = limit === undefined ? 1100 : Math.min(1100, limit * frameSizes[selector === "a:0" ? 0 : 1]!);
          const packets = frameSizes.flatMap((size, stream) =>
            Array.from({ length: Math.ceil(1100 / size) }, (_, i) => {
              const pts = i * size, duration = Math.min(size, 1100 - pts);
              return { stream, pts, duration, bytes: pcm.subarray(pts * 4, (pts + duration) * 4) };
            }).filter(packet => packet.pts + packet.duration <= end));
          packets.sort((a, b) => a.pts - b.pts || a.stream - b.stream);
          if (format === "streamhash") {
            assert.deepEqual(rows, [0, 1].map(stream => {
              const payload = Buffer.concat(packets.filter(packet => packet.stream === stream).map(packet => packet.bytes));
              return `${stream},a,SHA256=${createHash("sha256").update(payload).digest("hex")}`;
            }));
          } else {
            assert.deepEqual(rows, packets.map(({ stream, pts, duration, bytes }) =>
              `${stream}, ${String(pts).padStart(10)}, ${String(pts).padStart(10)}, ${String(duration).padStart(8)}, ${String(bytes.length).padStart(8)}, ${createHash("sha256").update(bytes).digest("hex")}`));
          }
        });
      }
    }
  }
}
