import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg pixel orders for grayscale rows 10,20,... at each input size.
for (const [width, height, orders] of [
  [3, 2, [
    [10, 40, 20, 50, 30, 60], [40, 10, 50, 20, 60, 30],
    [30, 60, 20, 50, 10, 40], [60, 30, 50, 20, 40, 10]
  ]],
  [2, 3, [
    [10, 30, 50, 20, 40, 60], [50, 30, 10, 60, 40, 20],
    [20, 40, 60, 10, 30, 50], [60, 40, 20, 50, 30, 10]
  ]],
  [2, 2, [
    [10, 30, 20, 40], [30, 10, 40, 20],
    [20, 40, 10, 30], [40, 20, 30, 10]
  ]]
] as const) {
  for (const [direction, name] of ["cclock_flip", "clock", "cclock", "clock_flip"].entries()) {
    for (const value of [name, String(direction)]) {
      for (const options of [value, `dir=${value}`]) {
        it(`transpose=${options} matches native pixels for ${width}x${height}`, async () => {
          const volume = new Volume();
          volume.writeFileSync("/in.png", encodeImage({
            width, height, channels: 4,
            data: Uint8Array.from([10, 20, 30, 40, 50, 60].slice(0, width * height)
              .flatMap(gray => [gray, gray, gray, 255])),
            format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: false
          }, { format: "png" }).data);
          const errors: Uint8Array[] = [];
          const result = await createFfmpegCommand().execute({
            args: ["-i", "/in.png", "-vf", `transpose=${options}`, "-frames:v", "1", "/out.png"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
          const output = decodeImage(volume.readFileSync("/out.png") as Buffer);
          assert.equal(output.width, height);
          assert.equal(output.height, width);
          assert.deepEqual([...output.data.filter((_, index) => index % 4 === 0)], orders[direction]);
        });
      }
    }
  }
}

for (const [size, input, orders] of [
  ["2x2", "204060808080305070908080", [
    "206040808080307050908080", "602080408080703090508080",
    "408020608080509030708080", "804060208080905070308080"
  ]],
  ["4x2", "102030405060708011223344", [
    "105020603070408011223344", "501060207030804011223344",
    "408030702060105022114433", "804070306020501022114433"
  ]],
  ["4x4", "0102030405060708090a0b0c0d0e0f101112131415161718", [
    "0105090d02060a0e03070b0f04080c101113121415171618",
    "0d0905010e0a06020f0b0703100c08041311141217151816",
    "04080c1003070b0f02060a0e0105090d1214111316181517",
    "100c08040f0b07030e0a06020d0905011412131118161715"
  ]],
  ["3x2", "10203040506011223344", [
    "10402050306011223344", "40105020603011223344",
    "30602050104022114433", "60305020401022114433"
  ]]
] as const) {
  for (const type of ["Buffer", "Uint8Array"]) {
    for (const [filter, expected] of [
      ["null", input],
      ...["cclock_flip", "clock", "cclock", "clock_flip"].map((dir, index) => [`transpose=${dir}`, orders[index]]),
      ["transpose=clock,transpose=cclock", input],
      ["transpose=cclock_flip,transpose=cclock_flip", input],
      ["transpose=clock_flip,transpose=clock_flip", input],
      ["transpose=clock:passthrough=landscape", input]
    ]) {
      it(`${filter} preserves planar ${size} samples with ${type} input`, async () => {
        const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
        const reads: Uint8Array[] = [];
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", size, "-r", "1",
            "-i", "/in.raw", "-vf", filter, "-pix_fmt", "yuv420p", "-f", "rawvideo", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) {
              const bytes = volume.readFileSync(path) as Buffer;
              const data = type === "Buffer" ? bytes : Uint8Array.from(bytes);
              reads.push(data);
              return data;
            },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
        assert.ok(reads.length > 0);
        for (const bytes of reads) assert.equal(Buffer.from(bytes).toString("hex"), input, "input remains unchanged");
      });
    }
  }
}

for (const [chroma, input, rotated] of [
  ["420jpeg", "102030405060708011223344", "501060207030804011223344"],
  ["444", "102030405060708001020304050607081112131415161718",
    "501060207030804005010602070308041511161217131814"]
] as const) {
  for (const range of ["LIMITED", "FULL"]) {
    it(`preserves ${chroma} ${range} Y4M planes and rotated dimensions`, async () => {
      const inputBytes = Buffer.concat([
        Buffer.from(`YUV4MPEG2 W4 H2 F1:1 Ip A1:1 C${chroma} XCOLORRANGE=${range}\nFRAME\n`),
        Buffer.from(input, "hex")
      ]);
      const volume = Volume.fromJSON({ "/in.y4m": inputBytes });
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-i", "/in.y4m", "-vf", "transpose=clock", "/out.y4m"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      const output = volume.readFileSync("/out.y4m") as Buffer;
      const header = output.subarray(0, output.indexOf(10)).toString().split(" ");
      assert.ok(header.includes("W2"));
      assert.ok(header.includes("H4"));
      assert.ok(header.includes(`C${chroma}`));
      assert.ok(header.includes(`XCOLORRANGE=${range}`));
      const frameStart = output.indexOf("FRAME\n") + 6;
      assert.equal(output.subarray(frameStart).toString("hex"), rotated);
      assert.deepEqual(volume.readFileSync("/in.y4m"), inputBytes);
    });
  }
}
