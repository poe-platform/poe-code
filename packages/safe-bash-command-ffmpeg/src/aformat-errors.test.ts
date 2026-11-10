import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [-30000, -12345, -401, -1, 0, 1, 401, 12345, 30000];

// Native FFmpeg 7.0.2 statuses and PCM16 bytes, including preserved output on failure.
for (const [setting, exitCode] of [
  ["f=garbage", 234], ["sample_fmts=garbage", 234],
  ["r=bad", 234], ["sample_rates=bad", 234],
  ["cl=bogus", 234], ["channel_layouts=bogus", 234],
  ["no_such_opt=1", 8], ["f=u8", 0]
] as const) {
  for (const graph of [false, true]) {
    it(`returns native status and bytes for aformat ${setting} through ${graph ? "filter_complex" : "af"}`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.raw", input);
      const filter = `aformat=${setting}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      if (exitCode !== 0) {
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from("KEEP"));
        return;
      }
      const expected = Buffer.alloc(input.length);
      const levels = [-30208, -12544, -512, -256, 0, 0, 256, 12288, 29952];
      levels.forEach((sample, index) => expected.writeInt16LE(sample, index * 2));
      assert.deepEqual(volume.readFileSync("/out.raw"), expected);
    });
  }
}
