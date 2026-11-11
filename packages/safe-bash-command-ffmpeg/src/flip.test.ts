import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

const levels = [10, 20, 30, 40, 50, 60];
function png(values: number[], width: number) {
  return encodeImage({
    width, height: values.length / width, channels: 4,
    data: new Uint8Array(values.flatMap(value => [value, value, value, 255])),
    format: "png", space: "srgb", depth: "uchar", density: 72, hasAlpha: true
  }, { format: "png" }).data;
}

async function render(filter: string) {
  const volume = new Volume();
  for (let i = 1; i <= 3; i++) volume.writeFileSync(`/in${i}.png`, png(levels, 3));
  const existing = png([99], 1);
  volume.writeFileSync("/out1.png", existing);
  const errors: Uint8Array[] = [];
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-framerate", "1", "-i", "/in%d.png", "-vf", filter, "-frames:v", "3", "/out%d.png"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
  } as never);
  return { volume, existing, result, stderr: Buffer.concat(errors).toString() };
}

for (const direction of ["hflip", "vflip"]) {
  for (const [option, exitCode] of [["typo=1", 8], ["enable=bogus", 234], ["1", 234], ["enable=1:typo=1", 8], ["enable=", 234]] as const) {
    it(`${direction} rejects ${option} before writing any output frames`, async () => {
      const { volume, existing, result, stderr } = await render(`${direction}=${option}`);
      assert.equal(result.exitCode, exitCode, stderr);
      assert.ok(stderr.includes(direction), stderr);
      assert.deepEqual(volume.readFileSync("/out1.png"), Buffer.from(existing));
      assert.equal(volume.existsSync("/out2.png"), false);
      assert.equal(volume.existsSync("/out3.png"), false);
    });
  }

  for (const option of ["", "=enable=0", "=enable=1", "=enable=gte(n\\,1)", "=enable='gte(t,1)'"]) {
    it(`${direction}${option} produces the expected pixels across three frames`, async () => {
      const { volume, result, stderr } = await render(direction + option);
      assert.equal(result.exitCode, 0, stderr);
      const flipped = direction === "hflip" ? [30, 20, 10, 60, 50, 40] : [40, 50, 60, 10, 20, 30];
      for (let i = 1; i <= 3; i++) {
        const output = decodeImage(volume.readFileSync(`/out${i}.png`) as Buffer);
        const expected = option === "=enable=0" || (option.includes("gte") && i === 1) ? levels : flipped;
        assert.equal(output.width, 3);
        assert.equal(output.height, 2);
        assert.deepEqual(output.data, new Uint8Array(expected.flatMap(value => [value, value, value, 255])));
      }
    });
  }
}

// Native FFmpeg 7.0.2 raw RGBA output; the input packets start at bytes 0 and 32.
for (const [direction, expressions, expected] of [
  ["hflip", ["eq(pos\\,0)", "eq(n\\,0)"],
    "6d8aa7c4f916335085a2bfdc112e4b683d5a7794c9e6032055728face1fe1b38b1ceeb0825425f7c99b6d3f00d2a4764819ebbd8f5122f4c6986a3c0ddfa1734"],
  ["vflip", ["gte(pos\\,32)", "gte(n\\,1)"],
    "112e4b6885a2bfdcf91633506d8aa7c4e1fe1b3855728facc9e603203d5a7794819ebbd8f5122f4c6986a3c0ddfa1734b1ceeb0825425f7c99b6d3f00d2a4764"]
] as const) {
  for (const expression of expressions) {
    it(`${direction} enable=${expression} matches native rawvideo timeline output`, async () => {
      const input = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 29 + 17) % 256));
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "4x2",
          "-framerate", "2", "-i", "/in.raw", "-vf", `${direction}=enable=${expression}`,
          "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
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
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}

for (const [size, input, horizontal, vertical] of [
  ["2x2", "204060808080305070908080", "402080608080503090708080", "608020408080709030508080"],
  ["4x4", "0102030405060708090a0b0c0d0e0f101112131415161718",
    "04030201080706050c0b0a09100f0e0d1211141316151817",
    "0d0e0f10090a0b0c05060708010203041314111217181516"]
] as const) {
  for (const type of ["Buffer", "Uint8Array"]) {
    for (const [filter, expected] of [
      ["null", input], ["hflip", horizontal], ["vflip", vertical],
      ["hflip,hflip", input], ["vflip,vflip", input]
    ] as const) {
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

// Full rawvideo outputs captured from native FFmpeg 7.0.2 for two 4x2 RGBA frames.
const rawFlipOutputs = {
  unchanged: "112e4b6885a2bfdcf91633506d8aa7c4e1fe1b3855728facc9e603203d5a7794b1ceeb0825425f7c99b6d3f00d2a4764819ebbd8f5122f4c6986a3c0ddfa1734",
  hflip: "6d8aa7c4f916335085a2bfdc112e4b683d5a7794c9e6032055728face1fe1b380d2a476499b6d3f025425f7cb1ceeb08ddfa17346986a3c0f5122f4c819ebbd8",
  vflip: "e1fe1b3855728facc9e603203d5a7794112e4b6885a2bfdcf91633506d8aa7c4819ebbd8f5122f4c6986a3c0ddfa1734b1ceeb0825425f7c99b6d3f00d2a4764"
};
for (const direction of ["hflip", "vflip"] as const) {
  for (const [option, enabled] of [
    ["", true], ["=enable=0", false], ["=enable=1", true],
    ["=enable=NAN", false], ["=enable=0/0", false],
    ["=enable=1/0", true], ["=enable=INF", true], ["=enable=-INF", true],
    ["=enable=isnan(NAN)", true], ["=enable=isinf(INF)", true],
    ["=enable=abs(0/0)", false], ["=enable=abs(1/0)", true],
    ["=enable=0.49", false], ["=enable=-0.5", true]
  ] as const) {
    it(`${direction}${option} matches native raw RGBA timeline output`, async () => {
      const input = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 29 + 17) % 256));
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "4x2",
          "-framerate", "2", "-i", "/in.raw", "-vf", direction + option, "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
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
      assert.equal(volume.readFileSync("/out.raw").toString("hex"), rawFlipOutputs[enabled ? direction : "unchanged"]);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
