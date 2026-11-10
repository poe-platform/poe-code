import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const flags of ["all", "none", "-slice", "slice", "0", "+slice", "all-slice",
    "none+slice", "slice-slice", "slice+slice", "slice++slice", "slice--slice", "slice+-slice",
    "-1", "4294967295", "bogus", "slice+bogus", "slice+", "slice+++slice", "0.5", "4294967296"]) {
    it(`areverse thread_type=${flags} preserves reversed PCM (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(22);
      for (let i = 0; i < 11; i++) input.writeInt16LE(i + 1, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `${graph ? "areverse@flip" : "areverse"}=thread_type=${flags}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
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
        // Native FFmpeg reverses all eleven samples regardless of scheduling flags.
        assert.equal(volume.readFileSync("/out.raw").toString("hex"), "0b000a00090008000700060005000400030002000100");
      }
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
