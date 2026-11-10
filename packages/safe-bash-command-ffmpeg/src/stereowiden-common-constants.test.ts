import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

const input = encodeWav({
  sampleRate: 8000,
  channels: [
    Float64Array.from({ length: 48 }, (_, i) => (i % 8 === 0 ? 10000 : 100) / 32768),
    Float64Array.from({ length: 48 }, (_, i) => (i % 8 === 4 ? -8000 : -200) / 32768)
  ]
});

// Full PCM hash verified against native FFmpeg 7.0.2.
for (const graph of [false, true]) {
  for (const option of ["threads=default", "threads=min", "extra_hw_frames=default", "threads=0", "extra_hw_frames=-1"]) {
    it(`stereowiden ${option} matches native PCM (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
      const filter = `stereowiden=${option}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "/out.raw"],
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
      assert.equal(output.length, 192);
      assert.equal(createHash("sha256").update(output).digest("hex"),
        "d8946cf9ec48282d50565807344a90bcc2a15861e8ee95388fd69cfd6ca280f3");
    });
  }
}
