import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const options of [
    ":threads=default",
    ":threads=0",
    ":extra_hw_frames=default",
    ":extra_hw_frames=-1",
    ":threads=default:extra_hw_frames=default",
  ]) {
    for (const outputExists of [false, true]) {
      it(`atrim=end_sample=3${options} (${complex ? "complex" : "simple"}, output ${outputExists ? "exists" : "absent"})`, async () => {
        const input = Buffer.alloc(32);
        for (let i = 0; i < 16; i++) input.writeInt16LE(i + 1, i * 2);
        const existing = Buffer.from("existing output");
        const volume = Volume.fromJSON({ "/in.raw": input,
          ...(outputExists ? { "/out.raw": existing } : {}) });
        let stderr = "";
        const filter = `atrim=end_sample=3${options}`;
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
        assert.deepEqual(volume.readFileSync("/out.raw"), input.subarray(0, 6));
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
