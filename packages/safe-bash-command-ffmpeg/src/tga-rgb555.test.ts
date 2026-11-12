import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 24x3 RGBA -> targa, -pix_fmt rgb555le, -rle 0/1.
// Input RGBA at (x,y): [33+70*y, 17+65*floor(x/8), 128-24*y, 32+64*floor(x/8)].
const fixtures = [
  "AAACAAAAAAAAAAAAGAADABAgUBBQEFAQUBBQEFAQUBBQEFARUBFQEVARUBFQEVARUBFQElASUBJQElASUBJQElASTTBNNE0wTTRNME00TTBNNE0xTTVNMU01TTFNNU0xTTVNMk02TTJNNk0yTTZNMk02SlhKVEpYSlRKWEpUSlhKVEpZalVKWWpVSllqVUpZalVJWmpWSVpqVklaalZJWmpWAAAAAAAAAABUUlVFVklTSU9OLVhGSUxFLgA=",
  "AAAKAAAAAAAAAAAAGAADABAgh1AQh1ARh1ASF00wTTRNME00TTBNNE0wTTRNMU01TTFNNU0xTTVNMU01TTJNNk0yTTZNMk02TTJNNhdKWEpUSlhKVEpYSlRKWEpUSllqVUpZalVKWWpVSllqVUlaalZJWmpWSVpqVklaalYAAAAAAAAAAFRSVUVWSVNJT04tWEZJTEUuAA=="
];

for (const [rle, fixture] of fixtures.entries()) {
  it(`decodes native packed RGB555 Targa to exact RGBA, rle=${rle}`, async () => {
    const volume = Volume.fromJSON({ "/in.tga": Buffer.from(fixture, "base64") });
    const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.tga", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(stderr).toString());
    const rgba = Buffer.concat(stdout);
    assert.equal(rgba.length, 288);
    assert.equal(createHash("sha256").update(rgba).digest("hex"),
      "52e35f898c2b2acdea2005b3d76906ff17434bd45726013f4770150159b22bb4");
  });
}
