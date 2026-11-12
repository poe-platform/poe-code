import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [format, source, filter, expected] of [
  ["gray", "111c27323d48535e", "lut=c0=negval", "eee3d8cdc2b7aca1"],
  ["gray16le", "111c27323d48535e69747f8a95a0abb6", "lut=c0=val/2", "080e13191e24292f343a3f454a50555b"],
  ["gray16le", "111c27323d48535e69747f8a95a0abb6", "lut=c0=val", "111c27323d48535e69747f8a95a0abb6"],
  ["gray16le", "111c27323d48535e69747f8a95a0abb6", "null", "111c27323d48535e69747f8a95a0abb6"],
  ["gray16be", "00000001ffff800012340100fffe7fff", "lut=negval", "ff00feff00007f00ecccfe0000007f01"],
  ["gray16le", "00000100ffff008034120001feffff7f", "lut=c0=val*2", "0000020000ff00ff6824000200ff00ff"],
  ["gray16le", "00000100ffff008034120001feffff7f", "lut=c0=maxval", "00ff00ff00ff00ff00ff00ff00ff00ff"],
  ["gray16le", "00000100ffff008034120001feffff7f", "lut", "0000010000ff00803412000100ffff7f"],
  ["gray", "111c27323d48535e", "lut", "111c27323d48535e"],
  ["gray", "111c27323d48535e", "lut=c0=maxval", "ffffffffffffffff"],
  ["gray16le", "111c27323d48535e69747f8a95a0abb6", "lut=c0=minval", "00000000000000000000000000000000"]
] as const) {
  it(`matches native ${format} ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.from(source, "hex") });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pixel_format", format,
        "-video_size", "4x2", "-framerate", "1", "-i", "/in.raw", "-vf", filter,
        "-frames:v", "1", "-pix_fmt", format, "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: { async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); } },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(output).toString("hex"), expected);
    assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), source);
  });
}
