import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 Linux statuses and raw bytes, including the valid control.
for (const [expression, status, output] of [
  ["mono|c0=0*c0+c0", 234, "4b454550"],
  ["mono|c0=c0|c0=c1", 234, "4b454550"],
  ["2C|FL=c1|FR=c0", 234, "4b454550"],
  ["mono|c0=LFE2", 234, "4b454550"],
  ["LFE2|LFE2=c0", 234, "4b454550"],
  ["LFE2|c0=c0", 0, "1027589e307500830004c7cf"],
  ["mono|c0=LFE", 0, "000000000000000000000000"],
  ["mono|c0=c0", 0, "1027589e307500830004c7cf"]
] as const) {
  for (const complex of [false, true]) {
    it(`returns native pan status and bytes (${complex ? "graph" : "simple"}): ${expression}`, async () => {
      const input = Buffer.from("102748f4589e6842307518790083cf8a00043815c7cfa05b", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const filter = `pan=${expression}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
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
      assert.equal(result.exitCode, status, stderr);
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(output, "hex"));
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
