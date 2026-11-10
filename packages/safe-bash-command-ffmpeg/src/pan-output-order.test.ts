import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 rejects custom output order during resampler configuration.
for (const [expression, exitCode, output] of [
  ["FR+FL|FR=c0|FL=c1", 234, ""],
  ["FR+FL|c0=c1|c1=c0", 234, ""],
  ["FL+FR|c0=c1|c1=c0", 0, "48f410276842589e18793075cf8a008338150004a05bc7cf"]
] as const) {
  for (const complex of [false, true]) {
    it(`matches pan output order (${expression}, graph=${complex})`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.raw", Buffer.from("102748f4589e6842307518790083cf8a00043815c7cfa05b", "hex"));
      const filters = complex
        ? ["-filter_complex", `[0:a]pan=${expression}[s]`, "-map", "[s]"]
        : ["-af", `pan=${expression}`];
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
      assert.equal(result.exitCode, exitCode, stderr);
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), output);
    });
  }
}
