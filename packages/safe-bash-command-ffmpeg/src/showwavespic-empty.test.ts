import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 output for the interleaved stereo PCM fixture below.
const pixels = Buffer.from("00000000000000007f3f00fe7f00007f7f00007f000000000000000000000000", "hex");
const checksumHeader = [
  "#format: frame checksums", "#version: 2", "#hash: MD5", "#tb 0: 1/1",
  "#media_type 0: video", "#codec_id 0: rawvideo", "#dimensions 0: 2x4",
  "#sar 0: 1/1", "#stream#, dts,        pts, duration,     size, hash", ""
].join("\n");

for (const filter of ["aselect=0", "atrim=end_sample=0", "aselect=1"]) {
  for (const format of ["rawvideo", "framemd5", "image2"]) {
    for (const target of format === "image2" ? ["/out.png"] : ["-", "/out.dat"]) {
      if (format === "image2" && filter === "aselect=1") continue;
      it(`finishes showwavespic after ${filter} as ${format} to ${target}`, async () => {
        const samples = [32767, 0, -32768, 1000, 0, 7000, 1234, -20000, 400, 500, 32767, 0, -3000, 12000, 128, 128];
        const input = Buffer.alloc(samples.length * 2);
        samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
        const volume = Volume.fromJSON({ "/in.raw": input });
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
            "-filter_complex", `[0:a]${filter},showwavespic=s=2x4[pic]`, "-map", "[pic]",
            "-frames:v", "1", "-pix_fmt", "rgba", "-bitexact", "-f", format, target],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.equal(stderr, "");
        if (format === "image2") {
          assert.equal(volume.existsSync(target), false);
          assert.equal(Buffer.concat(stdout).length, 0);
          return;
        }
        const output = target === "-" ? Buffer.concat(stdout) : volume.readFileSync(target) as Buffer;
        if (format === "rawvideo") {
          assert.deepEqual(output, filter === "aselect=1" ? pixels : Buffer.alloc(0));
        } else {
          const row = filter === "aselect=1"
            ? `0,          0,          0,        1,       32, ${createHash("md5").update(pixels).digest("hex")}\n` : "";
          assert.equal(output.toString(), checksumHeader + row);
        }
      });
    }
  }
}
