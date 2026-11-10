import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = Buffer.alloc(288);
for (let i = 0; i < 72; i++) {
  input.writeInt16LE((i * 2341) % 24000 - 12000, i * 4);
  input.writeInt16LE((i * 1793 + 8000) % 30000 - 15000, i * 4 + 2);
}

// Native FFmpeg 7.0.2 output for the default 2.1, 4.0 and 5.1 input layouts.
const hashes = new Map([
  [3, "817606c695a42f404efc6dca2b220970a6ddaa2665e912ce6fb95c99664dff39"],
  [4, "6a47ea14f6e8fce394d051360d5ed2056ab83934e22108266f030efbf499878c"],
  [6, "e908980f22a77201986ae3d1775cfeddfa7d04bcb41f4cc035b1a505b1ae9a69"]
]);

for (const channels of [2, 3, 4, 6]) {
  for (const graph of [false, true]) {
    for (const filter of ["anull", "aformat=channel_layouts=stereo", "aformat=cl=stereo"]) {
      for (const autoConvert of filter === "anull" || channels === 2 ? [true] : [true, false]) {
        it(`converts ${channels} channels with ${filter} (graph=${graph}, autoConvert=${autoConvert})`, async () => {
          const volume = Volume.fromJSON({ "/in.raw": input, "/out": "KEEP" });
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-y", "-v", "error", ...(!autoConvert ? ["-noauto_conversion_filters"] : []),
              "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
              ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
              "-f", "s16le", "/out"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          const output = volume.readFileSync("/out") as Buffer;
          if (!autoConvert) {
            assert.notEqual(result.exitCode, 0);
            assert.match(stderr, /automatic conversion is disabled/);
            assert.equal(output.toString(), "KEEP");
            return;
          }
          assert.equal(result.exitCode, 0, stderr);
          if (filter === "anull" || channels === 2) {
            assert.deepEqual(output, input);
          } else {
            assert.equal(output.length, input.length / channels * 2);
            assert.equal(createHash("sha256").update(output).digest("hex"), hashes.get(channels));
          }
        });
      }
    }
  }
}
