import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 2000 silent samples followed by 400 samples at 16384.
// A downstream trim requests the next complete frame to discover EOF.
for (const [prefix, suffix, limit, samples, measured, reset] of [
  ["", "", "1", 512, 512, 0],
  ["", ",atrim=end_sample=10", undefined, 10, 1024, 0],
  ["atrim=end_sample=10,", "", undefined, 10, 10, 0],
  ["", "", undefined, 2400, 2400, 0],
  ["", ",atrim=end_sample=10", "1", 10, 512, 0],
  ["", ",anull,volume@pass=1,atrim@end=end_sample=512", undefined, 512, 1024, 0],
  ["asetnsamples=256:0,", ",atrim=end_sample=10", undefined, 10, 512, 0],
  ["", ",asetnsamples=128:p=0", "3", 384, 512, 0],
  ["", ",asetnsamples=700:p=0", "2", 1400, 1536, 0],
  ["", ",areverse", "1", 352, 2400, 0],
  ["", "", "3", 1536, 512, 2],
  ["", ",atrim=end_sample=10", undefined, 10, 512, 1]
] as const) {
  for (const metadata of [0, 1]) for (const graph of [false, true]) {
    const filter = `${prefix}astats@levels=metadata=${metadata}:reset=${reset}:measure_perchannel=none:measure_overall=Number_of_samples+Max_level${suffix}`;
    it(`astats measures demanded frames: ${filter}, limit ${limit}, graph=${graph}`, async () => {
      const channel = new Float64Array(2400);
      channel.fill(0.5, 2000);
      const volume = Volume.fromJSON({
        "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000, channels: [channel] }))
      });
      let stderr = "";
      const chunks: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-guess_layout_max", "0", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...(limit === undefined ? [] : ["-frames:a", limit]), "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const expected = Buffer.alloc(samples * 2);
      for (let i = 0; i < samples; i++) {
        if (suffix.includes("areverse") ? i < 400 : i >= 2000) expected.writeInt16LE(16384, i * 2);
      }
      assert.deepEqual(Buffer.concat(chunks), expected);
      assert.equal(stderr, `Overall\nMax level: ${measured === 2400 ? "16384" : "0"}.000000\nNumber of samples: ${measured}\n`);
    });
  }
}
