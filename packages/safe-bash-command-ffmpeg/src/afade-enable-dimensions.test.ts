import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output for 16 alternating samples at 8 kHz.
const input = [12000, -12000, 12000, -12000, 12000, -12000, 12000, -12000,
  12000, -12000, 12000, -12000, 12000, -12000, 12000, -12000];
const faded = [0, -1500, 3000, -4500, 6000, -7500, 9000, -10500,
  12000, -12000, 12000, -12000, 12000, -12000, 12000, -12000];

for (const [enable, expected, initial] of [
  ["h", input, "1"],
  ["not(h)", faded, "0"],
  ["w", input, "1"],
  ["not(w)", faded, "0"]
] as const) {
  for (const scheduled of [false, true]) {
    for (const graph of [false, true]) {
      it(`afade enable=${enable} exposes zero audio dimensions (${scheduled ? "scheduled" : "initial"}, ${graph ? "graph" : "simple"})`, async () => {
        const fs = Volume.fromJSON({});
        const bytes = Buffer.alloc(input.length * 2);
        input.forEach((sample, index) => bytes.writeInt16LE(sample, index * 2));
        fs.writeFileSync("/in.raw", bytes);
        const filter = scheduled
          ? `asendcmd=c='0 afade@x enable ${enable}',afade@x=ns=8:enable=${initial}`
          : `afade=ns=8:enable=${enable}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ac", "1", "-ar", "8000", "-i", "/in.raw", ...(graph
            ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"]
            : ["-af", filter]), "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
            async stat(path: string) { return fs.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = fs.readFileSync("/out.raw") as Buffer;
        assert.equal(output.length, input.length * 2);
        assert.deepEqual(Array.from({ length: input.length }, (_, index) => output.readInt16LE(index * 2)), expected);
      });
    }
  }
}
