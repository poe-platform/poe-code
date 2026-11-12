import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 24x3 RGBA, (33+70*y, 17+65*(x/8|0), 128-24*y, 32+64*(x/8|0)).
// Encoded with -c:v targa -pix_fmt gray|bgra -rle 0|1 -f image2pipe.
for (const [format, rle, input, hash] of [
  ["gray", 0, "000003000000000000000000180003000820222222222222222249494949494949496f6f6f6f6f6f6f6f35353535353535355b5b5b5b5b5b5b5b818181818181818147474747474747476d6d6d6d6d6d6d6d9393939393939393000000000000000054525545564953494f4e2d5846494c452e00",
    "7c07c1112c743d1e7f6c75a8b0a4088c8f76819c7ee7825f058a206d093db134"],
  ["gray", 1, "00000b00000000000000000018000300082087228749876f8735875b87818747876d8793000000000000000054525545564953494f4e2d5846494c452e00",
    "7c07c1112c743d1e7f6c75a8b0a4088c8f76819c7ee7825f058a206d093db134"],
  ["bgra", 0, "00000200000000000000000018000300202880112120801121208011212080112120801121208011212080112120801121208052216080522160805221608052216080522160805221608052216080522160809321a0809321a0809321a0809321a0809321a0809321a0809321a0809321a068116720681167206811672068116720681167206811672068116720681167206852676068526760685267606852676068526760685267606852676068526760689367a0689367a0689367a0689367a0689367a0689367a0689367a0689367a05011ad205011ad205011ad205011ad205011ad205011ad205011ad205011ad205052ad605052ad605052ad605052ad605052ad605052ad605052ad605052ad605093ada05093ada05093ada05093ada05093ada05093ada05093ada05093ada0000000000000000054525545564953494f4e2d5846494c452e00",
    "92397939244fd6ff1d534e210977a36045a747b801e1b85e416397e4dce60b3c"],
  ["bgra", 1, "00000a0000000000000000001800030020288780112120878052216087809321a08768116720876852676087689367a0875011ad20875052ad60875093ada0000000000000000054525545564953494f4e2d5846494c452e00",
    "92397939244fd6ff1d534e210977a36045a747b801e1b85e416397e4dce60b3c"],
] as const) {
  it(`decodes native ${format} Targa to exact RGBA samples, rle=${rle}`, async () => {
    const volume = Volume.fromJSON({ "/in.tga": Buffer.from(input, "hex") });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.tga", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    const output = Buffer.concat(stdout);
    assert.equal(output.length, 24 * 3 * 4);
    assert.equal(createHash("sha256").update(output).digest("hex"), hash);
  });
}
