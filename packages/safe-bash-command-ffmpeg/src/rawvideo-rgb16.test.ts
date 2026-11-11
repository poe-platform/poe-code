import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(input: string, format: string, args: string[], options: Parameters<typeof createFfmpegCommand>[0] = {}, size = "4x2") {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex"), "/out.raw": "keep" });
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", format, "-s", size, "-r", "2",
      "-i", "/in.raw", ...args, "-f", "rawvideo", "/out.raw"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, output: volume.readFileSync("/out.raw") as Buffer };
}

// Native FFmpeg 7.0.2, two 4x2 frames at 2 fps.
for (const [source, target, length, expected] of [
  ["rgb48be", "rgb48be", 96, null],
  ["rgba64be", "rgba64be", 128, null],
  ["rgb48be", "rgb24", 96, "114b86c0f9336ea8e21b5590ca033d78b2eb255f9ad40d4782bcf52f6aa4de17518cc6ff3974aee7215b96d009437eb8"],
  ["rgba64be", "rgba", 128, "114b86c0f9336da8e21b5590ca033d78b2eb255f9ad40d4782bcf52f6aa4de17518cc6ff3974aee7215b96d009437eb8f12b65a0da134d88c2fb3570aae31d57"],
  ["rgb24", "rgb48be", 48, "11032dfb4b0467fe8501a1fdbeffdc02f8fe160432fc50056cfe8a02a6fec400e103fdff1b0537fd550671ff8f03abffc8e6e610030120053cfd5a0677009403b100cde2eb0d07fe250641fe5f077bfc9900b5fcd2e3f00d0cff2a0246fa6403"],
  ["rgb24", "rgba64be", 48, "11032dfb4b04ffff67fe8501a1fdffffbeffdc02f8feffff160432fc5005ffff6cfe8a02a6feffffc400e103fdffffff1b0537fd5506ffff71ff8f03abffffffc8e6e6100301ffff20053cfd5a06ffff77009403b100ffffcde2eb0d07feffff250641fe5f07ffff7bfc9900b5fcffffd2e3f00d0cffffff2a0246fa6403ffff"],
  ["rgb24", "rgb24", 48, null],
  ["gray16be", "gray16be", 32, null]
] as const) {
  it(`matches native rawvideo ${source} to ${target}`, async () => {
    const input = Buffer.from(Array.from({ length }, (_, i) => (i * 29 + 17) % 256)).toString("hex");
    const result = await run(input, source, ["-vf", "null", "-pix_fmt", target]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected ?? input);
  });
}

// Native FFmpeg 7.0.2: gray8 widens directly, without RGB color conversion.
for (const source of ["gray", "gray8"]) {
  for (const [target, expected] of [
    ["rgb48be", "0a000a000a000b000b000b001e001e001e001f001f001f00"],
    ["rgba64be", "0a000a000a00ffff0b000b000b00ffff1e001e001e00ffff1f001f001f00ffff"],
    ["rgb24", "0a0a0a0b0b0b1e1e1e1f1f1f"]
  ] as const) {
    it(`matches native ${source} to ${target} component precision`, async () => {
      const result = await run("0a0b1e1f", source,
        ["-vf", "null", "-fps_mode", "passthrough", "-pix_fmt", target, "-bitexact"], {}, "2x2");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.output.toString("hex"), expected);
    });
  }
}

for (const format of ["rgb48be", "rgba64be"]) {
  it(`widens all gray8 values across multiple frames to ${format}`, async () => {
    const input = Buffer.from(Array.from({ length: 256 }, (_, value) => value));
    const expected = Buffer.from([...input].flatMap(value =>
      [value, 0, value, 0, value, 0, ...(format === "rgba64be" ? [255, 255] : [])]));
    const result = await run(input.toString("hex"), "gray",
      ["-vf", "null", "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.output, expected);
  });

  for (const source of ["gray", "rgb24", format]) {
    it(`checks complete output size before replacing ${source} to ${format}`, async () => {
      const channels = format === "rgb48be" ? 6 : 8;
      const length = 16 * (source === "gray" ? 1 : source === "rgb24" ? 3 : channels);
      const input = Buffer.from(Array.from({ length }, (_, i) => (i * 29 + 17) % 256)).toString("hex");
      const result = await run(input, source, ["-vf", "null", "-pix_fmt", format],
        { limits: { maxOutputBytes: 16 * channels - 1 } });
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr, /maxOutputBytes/);
      assert.equal(result.output.toString(), "keep");
    });
  }
}

for (const [format, channels] of [["gray16be", 1], ["rgb48be", 3], ["rgba64be", 4]] as const) {
  for (const filter of ["null", "crop=iw:ih", "crop=2:2:1:1", "crop=3:3:1:1,crop=2:2:0:0"]) {
    it(`preserves every ${format} component through ${filter}`, async () => {
      const input = Buffer.alloc(48 * channels * 2);
      for (let pixel = 0; pixel < 48; pixel++) {
        for (let channel = 0; channel < channels; channel++) {
          input.writeUInt16BE([0x1234, 0x4567, 0x89ab, 0xbdef][channel]! + pixel,
            (pixel * channels + channel) * 2);
        }
      }
      const expected = filter === "null" || filter === "crop=iw:ih" ? input : Buffer.concat(
        [0, 16, 32].flatMap(frame => [5, 6, 9, 10].map(pixel =>
          input.subarray((frame + pixel) * channels * 2, (frame + pixel + 1) * channels * 2))));
      const result = await run(input.toString("hex"), format,
        ["-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", format], {}, "4x4");
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(result.output, expected);
    });
  }
}
