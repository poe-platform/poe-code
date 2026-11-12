import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 output at 8000 Hz, interleaved.
const samples = [101, -901, 202, -802, 303, -703, 404, -604];
const mono = [-400, -300, -200, -100];
for (const layout of ["downmix", "DL+DR", "stereo"]) {
  for (const [options, expected] of [
    [[], samples],
    [["-ac", "1"], mono],
    [["-ac", "2"], samples],
    [["-ch_layout", "mono"], mono],
    [["-ch_layout", "stereo"], samples],
    ...["aformat=channel_layouts=mono", "aresample=ochl=mono"].flatMap(filter => [
      [["-af", filter], mono],
      [["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"], mono]
    ] as const)
  ] as const) {
    for (const format of options[0] === "-af" || options[0] === "-filter_complex" ? ["s16le"] : ["s16le", "f32le"]) {
      it(`converts ${layout} with ${options.join(" ") || "unchanged output"} to ${format}`, async () => {
        const input = Buffer.alloc(samples.length * 2);
        samples.forEach((sample, index) => input.writeInt16LE(sample, index * 2));
        const volume = Volume.fromJSON({ "/in.raw": input });
        const stdout: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ch_layout", layout,
            "-i", "/in.raw", ...options, "-f", format, "pipe:1"],
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
        assert.equal(output.length, expected.length * (format === "s16le" ? 2 : 4));
        if (format === "s16le") {
          assert.deepEqual(Array.from({ length: expected.length }, (_, i) => output.readInt16LE(i * 2)), expected);
        } else {
          // Floating output keeps equal-power gain instead of normalizing the mono sum.
          const gain = expected === mono ? Math.SQRT2 : 1;
          expected.forEach((sample, index) => {
            assert.ok(Math.abs(output.readFloatLE(index * 4) - sample * gain / 32768) < 1e-8);
          });
        }
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
