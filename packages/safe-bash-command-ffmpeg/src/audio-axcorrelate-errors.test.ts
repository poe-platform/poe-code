import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2, two 12-sample mono PCM16 WAVs at 8000 Hz.
for (const [option, exitCode, pcm] of [
  ["size=1", 222, ""],
  ["algo=3", 222, ""],
  ["size=foo", 234, ""],
  ["bogus=1", 8, ""],
  ["enable=1", 176, ""],
  ["size=3:algo=fast", 0, "987fd37e1d7b175d90fbe31cb87011ec98ba5a8da6850080"]
] as const) {
  for (const output of ["pipe:1", "/out.pcm"]) {
    it(`axcorrelate=${option} preserves native status and PCM (${output})`, async () => {
      const volume = Volume.fromJSON({ "/out.pcm": "keep" });
      for (const [path, step] of [["/a.wav", 137], ["/b.wav", 193]] as const) {
        const samples = Float64Array.from({ length: 12 }, (_, i) => ((i * step) % 1700 - 850) / 32768);
        volume.writeFileSync(path, encodeWav({ sampleRate: 8000, channels: [samples] }));
      }
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
          `[0:a][1:a]axcorrelate=${option}[out]`, "-map", "[out]", "-f", "s16le", output],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(Buffer.concat(stdout).toString("hex"), output === "pipe:1" ? pcm : "");
      assert.deepEqual(volume.readFileSync("/out.pcm"),
        output === "/out.pcm" && exitCode === 0 ? Buffer.from(pcm, "hex") : Buffer.from("keep"));
      assert.equal(result.exitCode, exitCode, stderr);
      if (exitCode !== 0) assert.ok(stderr.includes("axcorrelate"), stderr);
    });
  }
}
