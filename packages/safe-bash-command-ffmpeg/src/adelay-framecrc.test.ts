import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 packet rows for eleven signed stereo pairs at 1000 Hz.
for (const complex of [false, true]) {
  for (const [delay, format, expected] of [
    [",adelay=3S|0S", "framecrc", "0,0,0,4,16,0x2dfe0676;0,4,4,4,16,0x3d3d0847;0,8,8,3,12,0x20400576;0,11,11,3,12,0x0ee201c2"],
    [",adelay=3S|5S", "framecrc", "0,0,0,3,12,0x00000000;0,3,3,4,16,0x1d5c04bc;0,7,7,4,16,0x4753081f;0,11,11,3,12,0x268f0657;0,14,14,2,8,0x07df02c3"],
    ["", "framecrc", "0,0,0,4,16,0x3fb807fc;0,4,4,4,16,0x404407fc;0,8,8,3,12,0x247505fd"],
    [",adelay=3S|0S", "s16le", "00009cff000038ff0000d4fe640070fec8000cfe2c01a8fd900144fdf401e0fc58027cfcbc0218fc2003b4fb84030000e80300004c040000"]
  ]) {
    it(`writes native ${format} for untimed stereo${delay} (complex ${complex})`, async () => {
      const input = Buffer.alloc(44);
      for (let i = 0; i < 11; i++) {
        input.writeInt16LE((i + 1) * 100, i * 4);
        input.writeInt16LE(-(i + 1) * 100, i * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `asetnsamples=n=4:p=0,asetpts=NAN${delay}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "-f", format, "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out") as Buffer;
      assert.equal(format === "s16le" ? output.toString("hex") : output.toString().split("\n")
        .filter(line => line && !line.startsWith("#"))
        .map(line => line.split(",").map(field => field.trim()).join(",")).join(";"), expected);
    });
  }
}
