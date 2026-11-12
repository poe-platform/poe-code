import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2-static: layout-only aformat negotiates float before remixing.
for (const [layout, time, freq] of [
  ["mono", "3ce911f3922e6ac39ce0cbdcf3d77dc93f8573d4bcec0605f746f372fd6eb565",
    "6063f4fe41d6e9d3eb0b8de029753f3165cc4db30df81cf3bc1bb79ce1ecd18e"],
  ["quad", "4ca9a2e563bdf74ec8f9f379650c51e732198005eb12d292601ea897b53eb203",
    "80554858fdd259d7487bc558d383a37b497250596afaa6263226bbe72f7ed918"]
] as const) {
  for (const [type, expected] of [["time", time], ["freq", freq]]) {
    for (const format of ["channel_layouts=stereo", "sample_fmts=fltp:channel_layouts=stereo"]) {
      it(`headphone ${type} negotiates ${layout} impulse aformat=${format}`, async () => {
        const volume = Volume.fromJSON({});
        for (const [j, name] of ["a", "b", "c"].entries()) {
          const length = j === 0 ? 240 : 16;
          const pcm = Buffer.alloc(length * 2);
          for (let i = 0; i < length; i++) {
            pcm.writeInt16LE(j === 0 ? i * 437 % 8001 - 4000 : i === j ? 8192 : i === j + 1 ? 4096 : 0, i * 2);
          }
          volume.writeFileSync(`/${name}.raw`, pcm);
        }
        const output: Uint8Array[] = [], errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error",
            "-f", "s16le", "-ar", "8000", "-ch_layout", "stereo", "-i", "/a.raw",
            "-f", "s16le", "-ar", "8000", "-ch_layout", layout, "-i", "/b.raw",
            "-f", "s16le", "-ar", "8000", "-ch_layout", "stereo", "-i", "/c.raw",
            "-filter_complex", `[1:a]aformat=${format}[ir];[0:a][ir][2:a]headphone=map=FL|FR:type=${type}[o]`,
            "-map", "[o]", "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(data: Uint8Array) { output.push(data); } },
          stderr: { async write(data: Uint8Array) { errors.push(data); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        assert.equal(Buffer.concat(errors).toString(), "");
        const pcm = Buffer.concat(output);
        assert.equal(pcm.length, 480);
        assert.equal(createHash("sha256").update(pcm).digest("hex"), expected);
      });
    }
  }
}
