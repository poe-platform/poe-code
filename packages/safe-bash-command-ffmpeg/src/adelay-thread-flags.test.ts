import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const flags of ["none", "all", "-slice", "slice", "0", "+slice", "all-slice",
    "none+slice", "slice-slice", "all+slice", "slice+slice", "4294967295", "slice++slice", "slice--slice", "slice+-slice", "-1",
    "bogus", "slice+bogus", "slice+", "slice+++slice", "0.5", "4294967296"]) {
    it(`adelay thread_type=${flags} preserves stereo PCM (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(32);
      for (let i = 1; i <= 8; i++) {
        input.writeInt16LE(100 * i, (i - 1) * 4);
        input.writeInt16LE(-100 * i, (i - 1) * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `adelay=2S|4S:thread_type=${flags}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (["bogus", "slice+bogus", "slice+", "slice+++slice", "0.5", "4294967296"].includes(flags)) {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.existsSync("/out.raw"), false);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, 48);
        // Native FFmpeg 7.0.2: thread flags leave these twelve stereo PCM16 pairs unchanged.
        assert.deepEqual(Array.from({ length: 12 }, (_, i) => [
          output.readInt16LE(i * 4), output.readInt16LE(i * 4 + 2)
        ]), [[0, 0], [0, 0], [100, 0], [200, 0], [300, -100], [400, -200],
          [500, -300], [600, -400], [700, -500], [800, -600], [0, -700], [0, -800]]);
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
