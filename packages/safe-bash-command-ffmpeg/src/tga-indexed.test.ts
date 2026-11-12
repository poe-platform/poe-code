import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: 24x3 RGBA input with pixel (x,y) =
// [33+70*y, 17+65*floor(x/8), 128-24*y, 32+64*floor(x/8)], encoded as pal8 Targa.
// The palette is FFmpeg's fixed BGR8 map; payloads include its quantization dithering.
for (const rle of [false, true]) {
  it(`decodes native indexed Targa to identical RGBA, RLE=${rle}`, async () => {
    const header = [0, 1, rle ? 9 : 1, 0, 0, 0, 1, 24, 0, 0, 0, 0, 24, 0, 3, 0, 8, 32];
    const palette = Array.from({ length: 256 }, (_, i) => [(i >> 6) * 85, ((i >> 3) & 7) * 36, (i & 7) * 36]).flat();
    const payload = rle
      ? [23,129,64,129,65,129,64,129,65,145,80,145,81,145,80,145,81,161,96,161,97,161,96,161,97,0,67,130,75,0,67,130,75,7,83,91,83,91,83,91,83,91,135,99,130,69,5,77,69,77,69,69,93,134,85,135,101]
      : [129,64,129,65,129,64,129,65,145,80,145,81,145,80,145,81,161,96,161,97,161,96,161,97,67,75,75,75,67,75,75,75,83,91,83,91,83,91,83,91,99,99,99,99,99,99,99,99,69,69,69,77,69,77,69,69,93,85,85,85,85,85,85,85,101,101,101,101,101,101,101,101];
    const volume = new Volume();
    volume.writeFileSync("/in.tga", Uint8Array.from([...header, ...palette, ...payload]));
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.tga", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
    const pixels = Buffer.concat(stdout);
    assert.equal(pixels.length, 288);
    assert.equal(createHash("sha256").update(pixels).digest("hex"), "05ff41c00aa8f2cf7f3ced305b10ddf091b402ef4097ba24447583f7293b804c");
  });
}
