import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: fill is applied before converting the stacked output.
for (const [inputFormat, branchFormat, outputFormat, gap] of [
  ["gray", "", "rgb24", [76, 76, 76]],
  ["gray", "", "gray", [76]],
  ["gray", "rgb24", "rgb24", [255, 0, 0]],
  ["rgb24", "", "rgb24", [255, 0, 0]],
  ["rgb24", "gray", "rgb24", [76, 76, 76]]
] as const) {
  it(`fills xstack gaps in ${branchFormat || inputFormat} before ${outputFormat} output`, async () => {
    const volume = Volume.fromJSON(Object.fromEntries(([
      ["a", [16, 32, 48, 64]], ["b", [96, 112]]
    ] as const).map(([name, values]) => [`/${name}.raw`, Buffer.from(
      values.flatMap(value => Array<number>(4 * (inputFormat === "gray" ? 1 : 3)).fill(value))
    )])));
    const prefix = branchFormat
      ? `[0:v]format=${branchFormat}[a];[1:v]format=${branchFormat}[b];[a][b]`
      : "[0:v][1:v]";
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", ...["a", "b"].flatMap(name => [
        "-f", "rawvideo", "-pixel_format", inputFormat, "-video_size", "2x2",
        "-framerate", "4", "-i", `/${name}.raw`
      ]), "-filter_complex", `${prefix}xstack=layout=0_0|w0+2_0:fill=red[out]`,
      "-map", "[out]", "-fps_mode", "passthrough", "-pix_fmt", outputFormat, "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
    const expected = Buffer.from([16, 32, 48, 64].flatMap((left, frame) => {
      const right = frame === 0 ? 96 : 112;
      const row = [...Array<number>(2 * gap.length).fill(left), ...gap, ...gap,
        ...Array<number>(2 * gap.length).fill(right)];
      return [...row, ...row];
    }));
    assert.deepEqual(Buffer.concat(stdout), expected);
  });
}
