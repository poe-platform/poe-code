import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/vibrato-timeline.wav", import.meta.url));

// Native FFmpeg accepts one trailing separator, including after a partial list.
for (const [options, valid] of [
  ["0.6:0.3:5:0.5", true],
  ["0.6:0.3:5:0.5:", true],
  ["in_gain=0.6:out_gain=0.3:delays=5:decays=0.5:", true],
  ["0.6:0.3:5:", true],
  ["0.6:0.3:5:0.5::", false],
  ["0.6::5:0.5:", false],
  ["0.6:0.3:5:0.5:1:", false]
] as const) {
  for (const graph of [false, true]) {
    it(`aecho=${options} handles separators (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.wav": input, "/out.pcm": "KEEP" });
      const filter = `aecho=${options}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.pcm"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (valid) {
        assert.equal(result.exitCode, 0, stderr);
        const output = volume.readFileSync("/out.pcm") as Buffer;
        assert.equal(output.length, 24080);
        assert.equal(createHash("sha256").update(output).digest("hex"),
          "64c07a7873881fcfdaa8ef9bead7d3dc860a06820d3d1098319058f17e018041");
      } else {
        assert.notEqual(result.exitCode, 0);
        assert.equal(volume.readFileSync("/out.pcm", "utf8"), "KEEP");
      }
    });
  }
}
