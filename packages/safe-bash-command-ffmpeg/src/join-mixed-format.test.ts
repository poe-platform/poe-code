import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const inputs = {
  s16le: ["0100fdff4701", "4701fdff0100"],
  s32le: ["01800100ff7fffff70110100", "70110100ff7fffff01800100"],
  f32le: ["7b142e3eae47e1bd3333b33e", "3333b33eae47e1bd7b142e3e"],
  f64le: ["0f3560000000e03fa07652000000d0bfbd564277499cb93f", "bd564277499cb93fa07652000000d0bf0f3560000000e03f"],
  u8: ["c38279", "7982c3"]
};

// Complete f64le output from native FFmpeg 7.0.2: join negotiates the first
// connected input's precision before the encoder widens the stereo samples.
for (const [first, second, expected] of [
  ["s16le", "s32le", "000000000000003f000000000000003f00000000000018bf00000000000000bf000000000070843f000000000000003f"],
  ["f32le", "f64le", "000000608fc2c53f00000080499cb93f000000c0f528bcbf000000000000d0bf000000606666d63f000000000000e03f"],
  ["s32le", "f64le", "000000001000083f00000078499cb93f000000002000f0be000080000000d0bf000000000017013f000080000000e03f"],
  ["u8", "f64le", "0000000000c0e03f000000000000ba3f000000000000903f000000000000d0bf000000000000acbf000000000000e03f"],
  ["u8", "s16le", "0000000000c0e03f000000000000803f000000000000903f00000000000080bf000000000000acbf0000000000000000"],
  ["u8", "s32le", "0000000000c0e03f0000000000000000000000000000903f00000000000080bf000000000000acbf0000000000000000"],
  ["u8", "f32le", "0000000000c0e03f000000000080d63f000000000000903f000000000000bcbf000000000000acbf000000000000c63f"],
  ["s16le", "f32le", "000000000000003f000000008066d63f00000000000018bf000000000028bcbf000000000070843f0000000000c3c53f"],
  ["f64le", "f64le", "0f3560000000e03fbd564277499cb93fa07652000000d0bfa07652000000d0bfbd564277499cb93f0f3560000000e03f"]
] as const) {
  for (const reverse of [false, true]) {
    for (const swap of [false, true]) {
      it(`converts join ${first}/${second} before f64le (reversed=${reverse}, swapped=${swap})`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/first", Buffer.from(inputs[first][0]!, "hex"));
        volume.writeFileSync("/second", Buffer.from(inputs[second][1]!, "hex"));
        let stderr = "";
        const sources = [[first, "/first"], [second, "/second"]];
        if (reverse) sources.reverse();
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", ...sources.flatMap(([format, path]) =>
            ["-f", format!, "-ar", "8000", "-ac", "1", "-i", path!]), "-filter_complex",
            `${reverse ? "[1:a][0:a]" : "[0:a][1:a]"}join=inputs=2${swap ? ":map=1.0-FL|0.0-FR" : ""}[o]`,
            "-map", "[o]", "-f", "f64le", "/out"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const bytes = Buffer.from(expected, "hex");
        const output = swap ? Buffer.concat([0, 16, 32].flatMap(offset =>
          [bytes.subarray(offset + 8, offset + 16), bytes.subarray(offset, offset + 8)])) : bytes;
        assert.deepEqual(volume.readFileSync("/out"), output);
      });
    }
  }
}
