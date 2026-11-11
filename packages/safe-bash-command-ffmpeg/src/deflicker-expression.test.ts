import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "0d5eaf0051a2f34495e63788d92a7bcc1d6ebf1061b20354a5f64798e93a8bdc";
const arithmeticTwo = "138bff0052a4f64497e93789ac2161a21d70c31085f40473a7f94799e93a8bdc";
const arithmeticThree = "159cff0053a6fa4582ca30779f1e5a96258ef61493ff047fa7fa489ae93a8bdc";
const geometric = "1495ff004489ce397ec32e73b72368ac2aa1ff179aff0485a8fa489be93a8bdc";

// Native FFmpeg 7.0.2 reference bytes; numeric options get fresh AVExpr state.
for (const [options, expected] of [
  ["s=2:m=none", arithmeticTwo],
  [String.raw`size=st(0\,3)`, arithmeticThree],
  [String.raw`m=randomi(0\,1\,1)`, geometric],
  ["s=2:m=am", arithmeticTwo],
  ["s=3", arithmeticThree],
  ["m=gm", geometric],
  ["size='st(0,3);ld(0)'", arithmeticThree],
  ["s='randomi(0,2.5,2.5)'", arithmeticTwo],
  ["s='2+random(0)*0'", arithmeticTwo],
  ["s='st(0,2)':m=ld(0)", arithmeticTwo],
  ["s='st(0,3)':s='ld(0)+2'", arithmeticTwo],
  ["s=2:m='st(0,1)':m=ld(0)", arithmeticTwo],
  ["s='st(0,1)'", undefined],
  ["s='randomi(0,129.1,129.1)'", undefined],
  ["m='st(0,7)'", undefined],
  ["m='randomi(0,-0.1,-0.1)'", undefined]
] as const) {
  it(`evaluates deflicker ${options} with native frame bytes and bounds`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray",
        "-video_size", "2x2", "-framerate", "2", "-i", "/in.raw",
        "-vf", `deflicker=${options}`, "-fps_mode", "passthrough",
        "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    if (expected === undefined) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(stderr.includes("must be between"), stderr);
      assert.equal(Buffer.concat(stdout).length, 0);
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    }
    assert.equal(volume.readFileSync("/in.raw").toString("hex"), input);
  });
}
