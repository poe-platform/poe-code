import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output for six stereo frames at 8 kHz.
for (const layout of ["downmix", "DL+DR"]) {
  for (const [channel, expected] of [
    ["DR", "48f468421879cf8a3815a05b"],
    ["FL", "000000000000000000000000"]
  ] as const) {
    for (const complex of [false, true]) {
      it(`preserves ${layout} speakers when selecting ${channel} (${complex ? "graph" : "simple"})`, async () => {
        const input = Buffer.from("102748f4589e6842307518790083cf8a00043815c7cfa05b", "hex");
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
        const filter = `pan=${layout}|DL=c0|DR=c1,pan=mono|c0=${channel}`;
        const filters = complex
          ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"]
          : ["-af", filter];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
            ...filters, "-f", "s16le", "/out.raw"],
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
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(expected, "hex"));
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
