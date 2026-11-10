import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 1536 multichannel PCM16 frames at 44100 Hz.
for (const [channels, suffix, outputFormat, hash] of [
  [4, "", "s16le", "3895f8476c6de1eb5b5bb7dc16d55f7e7259607d9ae4966c924a5a7c2cc1b2fb"],
  [6, "", "s16le", "b60faedb452640e3a971bc7208b1ed5e1eae55a04bd21e427ff1c37d90838a80"],
  [4, ",earwax", "s16le", "0a6fa54fb3f8470ca727d02abd9c6c7b7cbf50a0eb8d63325cf38fd0b365ab5b"],
  [4, "", "s32le", "028bb84f17ad2867ea3169941129eb3bcf3666ab27aeae3275b706c60eb9f137"]
] as const) {
  for (const format of ["s16", "s16p"]) {
    for (const graph of [false, true]) {
      for (const reversed of [false, true]) {
        const options = [`sample_fmts=${format}`, "channel_layouts=stereo"];
        if (reversed) options.reverse();
        const filter = `aformat=${options.join(":")}${suffix}`;
        it(`mixes ${channels} channels with ${filter} to ${outputFormat} (graph=${graph})`, async () => {
          const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
          volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 44100,
            channels: Array.from({ length: channels }, (_, c) =>
              Float64Array.from({ length: 1536 }, (_, i) => ((i * 421 + c * 1709) % 12000 - 6000) / 32768)) }));
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-hide_banner", "-loglevel", "error", "-y", "-i", "/in.wav", ...(graph
              ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
              "-f", outputFormat, "/out.raw"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          const output = volume.readFileSync("/out.raw") as Buffer;
          assert.equal(output.length, outputFormat === "s32le" ? 12288 : 6144);
          assert.equal(createHash("sha256").update(output).digest("hex"), hash);
        });
      }
    }
  }
}
