import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";
import { parseFilterExpression } from "./filter-expression.js";

it("evaluates gamma arguments and rejects invalid arity or use in other filters", () => {
  const variables = { minval: 0, maxval: 255, clipval: 128 };
  assert.equal(parseFilterExpression("gammaval(1+0)", "lutrgb", variables), 128);
  assert.throws(() => parseFilterExpression("gammaval(2,3)", "lutrgb", variables));
  assert.throws(() => parseFilterExpression("gammaval(2)", "scale", variables));
});

for (const [format, component, source, expected] of [
  ["rgb24", "r", "111c27323d48535e69747f8a95a0abb6c1ccd7e2edf8030e", "011c27093d481b5e69347f8a57a0ab81c1ccb5e2edf1030e"],
  ["rgba", "a", "111c27323d48535e69747f8a95a0abb6c1ccd7e2edf8030e19242f3a45505b66", "111c27093d48532269747f4a95a0ab81c1ccd7c8edf8030019242f0d45505b28"],
  ...(["rgb24", "rgba"] as const).map(format => {
    const channels = format === "rgb24" ? 3 : 4;
    const source = Buffer.alloc(256 * channels);
    const expected = Buffer.alloc(source.length);
    for (let value = 0; value < 256; value++) {
      for (let channel = 0; channel < channels; channel++) {
        const selected = channel === (channels === 3 ? 0 : 3);
        source[value * channels + channel] = selected ? value : 73 + channel;
        // Native gamma-2 curve: truncate the square normalized to the 8-bit range.
        expected[value * channels + channel] = selected ? Math.floor(value * value / 255) : 73 + channel;
      }
    }
    return [format, channels === 3 ? "r" : "a", source.toString("hex"), expected.toString("hex")] as const;
  })
] as const) {
  it(`matches native gammaval(2) for ${format} ${component} (${source.length / 2} bytes)`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.from(source, "hex") });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", format,
        "-video_size", `${source.length / 4 / (format === "rgba" ? 4 : 3)}x2`, "-framerate", "1", "-i", "/in.raw", "-vf", `lutrgb=${component}=gammaval(2)`,
        "-frames:v", "1", "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); } },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(output).toString("hex"), expected);
  });
}
