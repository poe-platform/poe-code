import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2: packet offsets survive reversal independently of frame PTS.
for (const complex of [false, true]) {
  for (const [filter, hex, pts] of [
    ["select=eq(pos\\,4)", "2930373e", 1],
    ["reverse,select=eq(pos\\,4)", "2930373e", 0],
    ["select=eq(pos\\,0)", "0d141b22", 0],
    ["select=eq(n\\,1)", "2930373e", 1],
    ["setpts=PTS+10,select=eq(pos\\,4)", "2930373e", 11],
    ["select=eq(pos\\,4),select=eq(pos\\,4)", "2930373e", 1],
    ["select=eq(pos\\,99)", "", undefined],
    ["select=0,select=eq(pos\\,4)", "", undefined]
  ] as const) {
    it(`select reads original packet positions: ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from("0d141b222930373e", "hex") });
      const output: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
          "-s", "2x2", "-r", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:v]${filter},showinfo[o]`, "-map", "[o]"]
            : ["-vf", `${filter},showinfo`]),
          "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(output).toString("hex"), hex);
      if (pts !== undefined) assert.ok(stderr.includes(`pts:${pts} `), stderr);
    });
  }
}
