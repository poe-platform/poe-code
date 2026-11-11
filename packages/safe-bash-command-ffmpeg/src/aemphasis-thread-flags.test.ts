import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [flags, exitCode] of [
    ...["default", "all-slice", "none", "all", "slice", "1", "0", "+slice", "-slice",
      "default-slice", "none+slice", "slice+slice", "slice-slice", "all+slice",
      "4294967295+slice", "slice++slice", "slice--slice", "slice+-slice",
      "-1", "4294967295", "min", "max", "max/max"]
      .map(flags => [flags, 0] as const),
    ["bogus", 234], ["slice+bogus", 234], ["", 234], ["slice+", 234],
    ["slice+++slice", 234], ["0.5", 222], ["4294967296", 222]
  ] as const) {
    it(`matches native aemphasis thread_type=${flags} (${graph ? "graph" : "simple"})`, async () => {
      const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(12).fill(1000 / 32768)] });
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input), "/out.raw": "existing" });
      const filter = `${graph ? "aemphasis@eq" : "aemphasis"}=thread_type=${flags}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
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
      if (exitCode === 0) {
        const output = volume.readFileSync("/out.raw") as Buffer;
        // Complete PCM16 output from native FFmpeg 7.0.2; scheduling flags leave it unchanged.
        assert.equal(output.length, 24);
        assert.deepEqual(Array.from({ length: 12 }, (_, i) => output.readInt16LE(i * 2)),
          [577, 1122, 1028, 1055, 1048, 1045, 1054, 1041, 1055, 1042, 1054, 1044]);
      } else {
        assert.equal(volume.readFileSync("/out.raw", "utf8"), "existing");
      }
      assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
    });
  }
}
