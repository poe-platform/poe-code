import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 statuses and PCM for eleven mono samples at 1000 Hz.
for (const [options, exitCode, diagnostic] of [
  ["1:1:2:0.5:1", 234, "No option name near '1'"],
  ["1:1:2:0.5:0", 234, "No option name near '0'"],
  ["threads=1:0.4:0.5:3:0.25", 234, "No option name near '0.25'"],
  ["1:1:2:0.5:bogus=1", 8, "unsupported option bogus"],
  ["1:1:2:0.5", 0, ""],
  ["1:1:2:0.5:", 0, ""]
] as const) {
  for (const graph of [false, true]) {
    it(`aecho positional options ${options} (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.alloc(22);
      for (let index = 0; index < 11; index++) input.writeInt16LE((index + 1) * 1000, index * 2);
      const volume = Volume.fromJSON({ "/in.raw": input });
      const output: Buffer[] = [];
      let stderr = "";
      const filter = `aecho=${options}`;
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.equal(Buffer.concat(output).toString("hex"), exitCode ? "" :
        "e803d007ac0d88136419401f1c25f82ad430b0368c3c88137c15");
      if (diagnostic) assert.ok(stderr.includes(diagnostic), stderr);
      else assert.equal(stderr, "");
    });
  }
}
