import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 8192 mono PCM16 samples at 8 kHz.
const period = [0, 4592, 8485, 11087, 12000, 11087, 8485, 4592,
  0, -4592, -8485, -11087, -12000, -11087, -8485, -4592];
for (const [option, hash] of [
  ["1/2", "2bbe04db8657672587c0b8ed75d524cb3085aa73eead6f0b70d1e156a2e9e681"],
  ["0.5", "2bbe04db8657672587c0b8ed75d524cb3085aa73eead6f0b70d1e156a2e9e681"],
  ["level=-6dB", "9ca0cc013bfc8898a10b53c6932154b31657d0d3566a5b7219c51d826a104b7d"],
  ["level=0.5011872336272722", "9ca0cc013bfc8898a10b53c6932154b31657d0d3566a5b7219c51d826a104b7d"],
  ["shift=2/1", null],
  ["shift=1/0", null],
  ["shift=1/", null],
  ["level=6dB", null],
  ["level=-6db", null]
] as const) for (const graph of [false, true]) {
  it(`aphaseshift=${option} checks expressions before replacing output (${graph ? "graph" : "simple"})`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
    volume.writeFileSync("/tone.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 8192 }, (_, i) => period[i % period.length]! / 32768)] }));
    const filter = `aphaseshift=${option}`;
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", "/tone.wav", ...(graph
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
    if (hash === null) {
      assert.notEqual(result.exitCode, 0, stderr);
      assert.ok(stderr.includes("aphaseshift:"), stderr);
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
    } else {
      assert.equal(result.exitCode, 0, stderr);
      const pcm = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(pcm.length, 16384);
      assert.equal(createHash("sha256").update(pcm).digest("hex"), hash);
    }
  });
}
