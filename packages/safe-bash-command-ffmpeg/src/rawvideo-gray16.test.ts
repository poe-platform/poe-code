import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const gray = "113a638cb5de07305982abd4fd264f78";
const rgb = "113a638cb5de07305982abd4fd264f78a1caf31c456e97c0";
// Native FFmpeg 7.0.2: RGB24, 2x2 at 1 fps, -vf null -pix_fmt gray16be.
const converted = "326aad652869a3686af5996760f48f6a";

async function run(input: string, format: string, args: string[], options: Parameters<typeof createFfmpegCommand>[0] = {}, size = "2x2", framerate = "1") {
  const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex"), "/out.raw": "keep" });
  let stderr = "";
  const result = await createFfmpegCommand(options).execute({
    args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", format, "-s", size, "-r", framerate,
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

for (const [input, args, expected] of [
  [gray, [], gray],
  [gray, ["-frames:v", "1"], gray.slice(0, 16)],
  [gray + "abcd12", [], gray + "abcd12"]
] as const) {
  it(`copies gray16be packets exactly (${args.join(" ")}, ${input.length / 2} bytes)`, async () => {
    const result = await run(input, "gray16be", ["-c:v", "copy", ...args], { limits: { maxFrames: 0 } });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}

for (const args of [[], ["-vf", "null"], ["-c:v", "rawvideo"]]) {
  it(`serializes RGB24 as full-precision big-endian grayscale (${args.join(" ")})`, async () => {
    const result = await run(rgb, "rgb24", [...args, "-pix_fmt", "gray16be"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), converted);
  });
}

it("preserves gray16be precision when encoding unchanged frames", async () => {
  const result = await run(gray, "gray16be", ["-vf", "null", "-c:v", "rawvideo"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(result.output.toString("hex"), gray);
});

for (const [input, format, args] of [[gray, "gray16be", ["-c:v", "copy"]], [rgb, "rgb24", ["-pix_fmt", "gray16be"]]] as const) {
  it(`enforces gray16be output limits before replacing output (${format})`, async () => {
    const result = await run(input, format, [...args], { limits: { maxOutputBytes: 15 } });
    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /maxOutputBytes/);
    assert.equal(result.output.toString(), "keep");
  });
}

const spatialInput = "112e4b6885a2bfdcf91633506d8aa7c4e1fe1b3855728facc9e603203d5a7794";
// Native FFmpeg 7.0.2, two 4x2 gray16be frames at 2 fps.
for (const [filter, expected] of [
  ["hflip", "bfdc85a24b68112ea7c46d8a3350f9168fac55721b38e1fe77943d5a0320c9e6"],
  ["vflip", "f91633506d8aa7c4112e4b6885a2bfdcc9e603203d5a7794e1fe1b3855728fac"],
  ["hflip,hflip", spatialInput],
  ["vflip,vflip", spatialInput],
  ["transpose=clock", "f916112e33504b686d8a85a2a7c4bfdcc9e6e1fe03201b383d5a557277948fac"],
  ["transpose=clock,transpose=cclock", spatialInput],
  ["transpose=clock:landscape", spatialInput],
  ["null", spatialInput]
] as const) {
  it(`preserves full gray16be samples through ${filter}`, async () => {
    const result = await run(spatialInput, "gray16be", ["-vf", filter, "-pix_fmt", "gray16be"], {}, "4x2", "2");
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.output.toString("hex"), expected);
  });
}
