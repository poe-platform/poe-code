import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

function fixture(format: string): Buffer {
  const chromaWidth = format === "yuv444p" ? 8 : 4;
  const chromaHeight = format === "yuv420p" ? 3 : 6;
  return Buffer.from([0, 1, 2].flatMap(plane => {
    const width = plane ? chromaWidth : 8;
    const height = plane ? chromaHeight : 6;
    return Array.from({ length: width * height }, (_, index) => {
      const x = index % width, y = Math.floor(index / width);
      return x === 0 && y === 0 ? 245 : x === 3 && y === 2 ? 4 : (x * 37 + y * 29 + x * y * 3 + plane * 53) % 251;
    });
  }));
}

async function run(format: string, filter: string, input = fixture(format)) {
  const volume = Volume.fromJSON({ "/in.raw": input });
  const chunks: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "error", "-f", "rawvideo", "-pixel_format", format,
      "-video_size", "8x6", "-framerate", "4", "-i", "/in.raw", "-vf", filter,
      "-fps_mode", "passthrough", "-pix_fmt", format, "-bitexact", "-f", "rawvideo", "pipe:1"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: { async readFile(path: string) { return volume.readFileSync(path); },
      async stat(path: string) { return volume.statSync(path); } },
    stdin: (async function* () {})(),
    stdout: { async write(data: Uint8Array) { chunks.push(Buffer.from(data)); } },
    stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  return Buffer.concat(chunks);
}

// Complete raw-output SHA-256 references from native FFmpeg 7.0.2, including borders.
for (const [format, hashes] of [
  ["yuv444p", ["5aa060966604f23a33d13b52af5796e96637ceaefb183bd157298c3988df3e79", "d529f5b95cc92d5c43e96c4418677dfa5e81a3d05821fb86e99f7c36ba4aa0fd", "b2182ef81b53a243644d3d00c8da394931246b984765e60f1e7307fe7b666bdd"]],
  ["yuv422p", ["4e03a5328104457d0ab0eaccc20be6a4cdf972c751a7ca7e339143d527eab193", "42f480ffe27d3e802ed3acdc5001bd1b43fd79e4aca05ad72829a5508fa5427d", "b704def6d1d3e3c8008aa37fccaf592f11471d1331e47504873d9593688b3358"]],
  ["yuv420p", ["af728004bc227f4bf7e9d3b625609dd4c0a035e16a7b38e138c3f165ad05c308", "5775e539dcaa8019a80e0f2140a814d4b6d3397666432609cc256e4030b426ee", "c53e42d4ccbd3208544e460ae96f069ab3d8e6295f5130382701369f89a78fc3"]]
] as const) {
  it(`preserves ${format} control and disabled planes`, async () => {
    for (const filter of ["null", "median=planes=0", "median=planes=8", "median=enable=0"]) {
      assert.deepEqual(await run(format, filter), fixture(format));
    }
  });

  for (const [index, filter] of ["median=planes=2", "median=planes=5", "median=radius=2:planes=2:radiusV=1:percentile=0.75"].entries()) {
    it(`matches native ${filter} on ${format} and preserves unselected planes`, async () => {
      const input = fixture(format);
      const output = await run(format, filter);
      assert.equal(output.length, input.length);
      assert.equal(createHash("sha256").update(output).digest("hex"), hashes[index]);
      const chromaSize = (input.length - 48) / 2;
      const boundaries = [0, 48, 48 + chromaSize, input.length];
      for (let plane = 0; plane < 3; plane++) {
        if (index === 1 ? plane !== 1 : plane === 1) continue;
        assert.deepEqual(output.subarray(boundaries[plane], boundaries[plane + 1]), input.subarray(boundaries[plane], boundaries[plane + 1]));
      }
    });
  }
}

it("applies the YUV plane mask only on enabled frames", async () => {
  const input = fixture("yuv444p");
  const filtered = await run("yuv444p", "median=planes=2");
  const output = await run("yuv444p", "median=planes=2:enable=gte(n\\,1)", Buffer.concat([input, input]));
  assert.deepEqual(output, Buffer.concat([input, filtered]));
});
