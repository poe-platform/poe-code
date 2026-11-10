import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg output for two 4x2 RGBA frames, at two frames per second.
const cases = [
  ["hflip=enable=1", "6d8aa7c4f916335085a2bfdc112e4b683d5a7794c9e6032055728face1fe1b380d2a476499b6d3f025425f7cb1ceeb08ddfa17346986a3c0f5122f4c819ebbd8"],
  ["vflip", "e1fe1b3855728facc9e603203d5a7794112e4b6885a2bfdcf91633506d8aa7c4819ebbd8f5122f4c6986a3c0ddfa1734b1ceeb0825425f7c99b6d3f00d2a4764"],
  ["vflip=enable=1", "e1fe1b3855728facc9e603203d5a7794112e4b6885a2bfdcf91633506d8aa7c4819ebbd8f5122f4c6986a3c0ddfa1734b1ceeb0825425f7c99b6d3f00d2a4764"],
  ["transpose=clock", "e1fe1b38112e4b6855728fac85a2bfdcc9e60320f91633503d5a77946d8aa7c4819ebbd8b1ceeb08f5122f4c25425f7c6986a3c099b6d3f0ddfa17340d2a4764"]
] as const;

for (const [filter, expected] of [
  ...cases.flatMap(([filter, expected]) => filter.includes("=")
    ? [[filter, expected], [`${filter}:`, expected]] : [[filter, expected]]),
  ...["hflip=enable=1::", "vflip=enable=1::", "transpose=clock::",
    "hflip=:enable=1", "vflip=enable=1::enable=1"]
    .map(filter => [filter, undefined])
]) {
  it(`${filter} ${expected ? "matches native output bytes" : "rejects empty options without replacing output"}`, async () => {
    const input = Buffer.from(Array.from({ length: 64 }, (_, i) => (i * 29 + 17) % 256));
    const volume = Volume.fromJSON({ "/in.raw": input, "/out.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-f", "rawvideo", "-pixel_format", "rgba",
        "-video_size", "4x2", "-framerate", "2", "-i", "/in.raw", "-vf", filter,
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
    if (expected) assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    else assert.notEqual(result.exitCode, 0);
    assert.deepEqual(volume.readFileSync("/out.raw"), expected ? Buffer.from(expected, "hex") : Buffer.from("KEEP"));
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
