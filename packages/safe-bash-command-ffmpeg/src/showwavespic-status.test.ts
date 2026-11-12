import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 exit statuses and RGBA output for this stereo PCM16 input.
for (const [option, status, expected, error] of [
  ["split_channels=3", 234, "", "invalid split_channels"],
  ["scale=oops", 234, "", "invalid scale"],
  ["what=3", 8, "", "unsupported option what"],
  ["split_channels=1", 0,
    "ff0000ffff0000ff000000000000000000000000000000000000000000000000", ""],
  ["scale=sqrt", 0,
    "00000000000000007f3f00fe7f3f00fe7f00007f7f00007f0000000000000000", ""]
] as const) {
  for (const target of ["-", "/out.raw"]) {
    it(`returns native showwavespic status and output for ${option} to ${target}`, async () => {
      const samples = [32767, 0, -32768, 1000, 0, 7000, 1234, -20000,
        400, 500, 32767, 0, -3000, 12000, 128, 128];
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          "-filter_complex", `showwavespic=s=2x4:${option}`, "-frames:v", "1",
          "-pix_fmt", "rgba", "-bitexact", "-f", "rawvideo", target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, status, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), target === "-" ? expected : "");
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"),
        target === "/out.raw" && status === 0 ? expected : Buffer.from("KEEP").toString("hex"));
      if (status === 0) assert.equal(stderr, "");
      else assert.ok(stderr.includes(error), stderr);
    });
  }
}
