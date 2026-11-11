import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  // Native FFmpeg 7.0.2: complete PCM16 output, including empty files on failure.
  for (const [layout, exitCode, hex] of [
    ["FL+FR", 0, "201af8fa930cad2b57ccf5057f04dddb"],
    ["FR+FL", 234, ""],
    ["FC+LFE", 0, "e313e313f209f2093ad83ad800000000"],
    ["BL+BR", 234, ""]
  ] as const) {
    it(`negotiates ${layout} before crossfeed (${complex ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({
        sampleRate: 16000,
        channels: [
          Float64Array.from([8000, 4000, -16000, 0], sample => sample / 32768),
          Float64Array.from([-2000, 12000, 3000, -9000], sample => sample / 32768)
        ]
      }));
      const filter = `channelmap=0|1:${layout},crossfeed`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(complex
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
          : ["-af", filter]), "-f", "s16le", "/out.raw"],
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
      assert.equal(volume.existsSync("/out.raw"), true);
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), hex);
    });
  }
}
