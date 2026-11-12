import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const inputSamples = [101, -901, 202, -802, 303, -703, 404, -604];
// Native FFmpeg 7.0.2, signed little-endian PCM16 at 8000 Hz.
const cases = [
  ["3.0", [0, 0, 101, 0, 0, 202, 0, 0, 303, 0, 0, 404]],
  ["4.0", [0, 0, 101, 0, 0, 0, 202, 0, 0, 0, 303, 0, 0, 0, 404, 0]],
  ["5.1", [0, 0, 101, -901, 0, 0, 0, 0, 202, -802, 0, 0, 0, 0, 303, -703, 0, 0, 0, 0, 404, -604, 0, 0]],
  ["FC+LFE", inputSamples],
  ["2.1", [71, 71, -901, 143, 143, -802, 214, 214, -703, 286, 286, -604]],
  ["", inputSamples],
  ["FL+FR+FC", [0, 0, 101, 0, 0, 202, 0, 0, 303, 0, 0, 404]],
  ["FL+FR+FC+LFE+BL+BR", [0, 0, 101, -901, 0, 0, 0, 0, 202, -802, 0, 0, 0, 0, 303, -703, 0, 0, 0, 0, 404, -604, 0, 0]]
] as const;

for (const option of ["-ch_layout", "-channel_layout:a:0"]) {
  for (const [layout, expected] of cases) {
    for (const graph of [false, true]) {
      it(`routes FC+LFE to ${layout || "unchanged output"} with ${option} (graph=${graph})`, async () => {
        const input = Buffer.alloc(inputSamples.length * 2);
        inputSamples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
        const volume = Volume.fromJSON({ "/in.raw": input });
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ch_layout", "FC+LFE", "-i", "/in.raw",
            ...(graph ? ["-filter_complex", "[0:a]anull[out]", "-map", "[out]"] : []),
            ...(layout ? [option, layout] : []), "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = Buffer.concat(stdout);
        assert.equal(output.length, expected.length * 2);
        assert.deepEqual(Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2)), expected);
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
