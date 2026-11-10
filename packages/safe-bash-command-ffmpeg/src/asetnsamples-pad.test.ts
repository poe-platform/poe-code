import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(11 * 2);
for (let index = 0; index < 11; index++) input.writeInt16LE(index + 1, index * 2);

// Native FFmpeg 7.0.2 keeps samples 1–11 and adds a twelfth zero only with padding.
for (const [value, pad] of [
  ["y", true], ["Y", true], ["n", false], ["N", false],
  ["+1", true], ["-0", false], ["+0", false], ["1", true], ["0", false],
  ["+0001", true], ["-0000", false],
  ["TrUe", true], ["FaLsE", false], ["YeS", true], ["No", false],
  ["On", true], ["Off", false],
  ["enable", true], ["EnAbLeD", true], ["disable", false], ["DiSaBlEd", false],
  ["-1", undefined], ["+2", undefined], ["1.0", undefined], ["1e0", undefined],
  ["0x1", undefined], ["+", undefined], ["--0", undefined], ["maybe", undefined]
] as const) {
  for (const options of [`n=4:p=${value}`, `nb_out_samples=4:pad=${value}`, `4:${value}`]) {
    for (const graph of [false, true]) {
      it(`asetnsamples=${options} handles padding (${graph ? "graph" : "simple"})`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": input });
        if (pad === undefined) volume.writeFileSync("/out.raw", "KEEP");
        const filter = `asetnsamples=${options}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
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
        if (pad === undefined) {
          assert.equal(result.exitCode, 234, stderr);
          assert.ok(stderr.includes("asetnsamples: invalid pad"), stderr);
          assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
        } else {
          assert.equal(result.exitCode, 0, stderr);
          assert.deepEqual(volume.readFileSync("/out.raw"), pad ? Buffer.concat([input, Buffer.alloc(2)]) : input);
        }
      });
    }
  }
}
