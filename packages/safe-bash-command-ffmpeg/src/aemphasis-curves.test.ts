import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 samples and multi-frame hashes captured from native FFmpeg 7.0.2.
for (const [type, id, mono, stereo, hash] of [
  ["col", 0, [386, 743, 446, 289, 296, 234, 243, 205],
    [78, 0, 187, -39, 176, -94, 142, -88, 134, -71, 112, -67, 105, -56, 93, -52, 241, -23, 454, 14, 425, 13, 353, 6, 331, 6, 287, 2, 268, 1, 242, -1],
    "1e061f9c080441f296b1772dc1c96ea522e75413f26e90815f5468b54c3496c4"],
  ["emi", 1, [454, 783, 356, 254, 307, 237, 265, 222],
    [106, 0, 245, -53, 210, -123, 151, -105, 135, -75, 104, -67, 94, -52, 79, -47, 284, -8, 557, 38, 480, 30, 360, 15, 324, 11, 261, 4, 239, 1, 210, -2],
    "569cbeeb1ad56acdc13f6217d269845bc60cbafcf3ed5ebf5bcb3620ce5eaa42"],
  ["bsi", 2, [497, 762, 216, 174, 248, 167, 217, 168],
    [132, 0, 295, -66, 230, -148, 145, -115, 123, -73, 84, -61, 74, -42, 58, -37, 316, 10, 637, 63, 502, 46, 332, 22, 284, 16, 206, 6, 185, 3, 154, -1],
    "725f2a7cb4fb8ffa749d97a674c09aa257ea36ce8d988cdf729f0b10a97af544"],
  ["50fm", 5, [480, 616, -25, -37, 38, -32, 25, -18],
    [155, 0, 308, -78, 206, -154, 126, -103, 93, -63, 51, -47, 42, -25, 21, -21, 328, 36, 625, 84, 419, 57, 256, 34, 189, 26, 104, 14, 84, 11, 43, 6],
    "d70bfefaa49b4f70b98fae60d2b50d113a7d9e0268fc5b167afc84c07c733b19"],
  ["75fm", 6, [421, 616, 90, -23, 26, -21, 16, -12],
    [121, 0, 246, -61, 181, -123, 133, -90, 108, -67, 73, -54, 63, -37, 41, -32, 279, 16, 516, 56, 381, 42, 280, 30, 227, 25, 155, 17, 132, 15, 88, 10],
    "547beae942e5f73c449c34e7e05f173effdd39adb19722f992db062aa7c5f737"],
  ["50kf", 7, [825, 182, -11, 6, -2, 1, 0, 0],
    [287, 0, 251, -143, 158, -126, 103, -79, 68, -52, 45, -34, 30, -23, 20, -15, 586, 76, 510, 69, 322, 43, 210, 28, 139, 19, 92, 12, 61, 8, 40, 5],
    "5b52731ea5077cadf35bb45d79efa72ff9b565e09ccdb5ed491453ab7d566878"],
  ["75kf", 8, [711, 256, 23, 10, 1, 0, 0, 0],
    [202, 0, 198, -101, 147, -99, 111, -74, 83, -55, 63, -42, 48, -32, 36, -24, 432, 43, 417, 46, 310, 34, 233, 25, 176, 19, 133, 14, 100, 11, 76, 8],
    "65ffb227da8a85fff9c5e9e59e6a85d0733cf1d0c2bf788529dd566be49f684f"],
] as const) {
  for (const [sampleRate, channelCount, count, expected] of [
    [8000, 1, 8, mono], [48000, 2, 32, stereo], [44100, 1, 5000, hash]
  ] as const) {
    for (const complex of [false, true]) {
      const selector = sampleRate === 48000 && id === 0 ? "min" : sampleRate === 48000 && id === 8 ? "max" : id;
      const filter = complex ? `aemphasis=1:1:0:${selector}` : `aemphasis=type=${type}`;
      it(`matches native ${type} at ${sampleRate} Hz (${complex ? "graph/numeric" : "simple/named"})`, async () => {
        const input = Buffer.alloc(count * 2);
        if (count === 5000) {
          for (let i = 0; i < count; i++) input.writeInt16LE((i * 7919) % 20001 - 10000, i * 2);
        } else {
          input.writeInt16LE(1001, 0);
          if (channelCount === 2) {
            input.writeInt16LE(-501, 6);
            input.writeInt16LE(2001, 32);
            input.writeInt16LE(301, 34);
          }
        }
        const volume = Volume.fromJSON({ "/in.raw": input });
        const chunks: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", "error", "-f", "s16le", "-ar", String(sampleRate),
            "-ac", String(channelCount), "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const pcm = Buffer.concat(chunks);
        assert.equal(pcm.length, input.length);
        if (typeof expected === "string") {
          assert.equal(createHash("sha256").update(pcm).digest("hex"), expected);
        } else {
          assert.deepEqual(Array.from({ length: count }, (_, i) => pcm.readInt16LE(i * 2)), expected);
        }
      });
    }
  }
}
