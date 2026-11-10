import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 3173 PCM16 samples of 16003 at 8 kHz.
for (const [filter, hash] of [
  ["aformat=sample_fmts=s16p", "a06650fabd877e358ca321039be911ad9edc05630df1fc595c47e43f708dc804"],
  ["aformat=sample_fmts=s32p", "a06650fabd877e358ca321039be911ad9edc05630df1fc595c47e43f708dc804"],
  ["aformat=sample_fmts=u8p", "e2c3fb0f8b6cb68c4ee36f58782e76b27d9ef91e7e657b46ee745780ca988e06"],
  ["aformat=sample_fmts=s16p,afade=ns=91", "9154c58c0de9ff83f7b8e984e9de9b88c08045ea8b99272ec635f749f5ec2326"],
  ["aformat=sample_fmts=s16", "a06650fabd877e358ca321039be911ad9edc05630df1fc595c47e43f708dc804"],
  ["aformat=sample_fmts=s32", "a06650fabd877e358ca321039be911ad9edc05630df1fc595c47e43f708dc804"],
  ["aformat=sample_fmts=u8", "e2c3fb0f8b6cb68c4ee36f58782e76b27d9ef91e7e657b46ee745780ca988e06"],
  ["aformat=sample_fmts=s16,afade=ns=91", "9154c58c0de9ff83f7b8e984e9de9b88c08045ea8b99272ec635f749f5ec2326"]
] as const) {
  for (const graph of [false, true]) {
    it(`matches native PCM for ${filter} (${graph ? "complex" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [new Float64Array(3173).fill(16003 / 32768)]
      }));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-y", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter},ashowinfo[out]`, "-map", "[out]"] : ["-af", `${filter},ashowinfo`]),
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
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, 6346);
      assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
