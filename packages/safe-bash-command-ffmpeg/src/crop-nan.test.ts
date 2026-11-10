import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["rgba", "gray16be", "rgb48be", "rgba64be", "yuv444p", "yuv420p"]) {
  for (const [coordinates, control, size] of [
    ["'if(eq(n,1),0/0,2-n)':0", "'if(eq(n,1),2,2-n)':0", 4],
    ["0:'if(eq(n,1),0/0,2-n)'", "0:'if(eq(n,1),2,2-n)'", 4],
    ["nan:nan", "1:1", 4],
    ["NaN:NAN", "1:1", 4],
    ["x+1:y", "1:1", 4],
    ["'if(eq(n,0),0/0,n-1)':0", "'if(eq(n,0),1,n-1)':0", 4],
    ["'if(eq(n,1),0/0,20-n)':0", "2:0", 4],
    ["'if(eq(n,1),0/0,1.5)':0", "2:0", 4],
    ["'if(eq(n,1),0/0,2-n)':x", "'if(eq(n,1),2,2-n)':x", 4],
    ["'if(eq(n,0),2,if(isnan(x),0,0/0))':0", "'if(eq(n,0),2,0)':0", 4],
    ["'if(eq(n,0),2,0/0)':'if(eq(n,0),0,0/0)'", "2:0", 4],
    ["nan:nan", "1:1", 5]
  ] as const) {
    it(`retains crop coordinates for ${coordinates} in ${size}x${size} ${format}`, async () => {
      const input = Buffer.from(Array.from({ length: 3 }, (_, frame) => {
        if (format.startsWith("yuv")) {
          const chroma = format === "yuv420p" ? Math.ceil(size / 2) ** 2 : size ** 2;
          return [...Array.from({ length: size ** 2 }, (_, i) => 16 + frame * 16 + i),
            ...Array.from({ length: chroma }, (_, i) => 32 + i),
            ...Array.from({ length: chroma }, (_, i) => 180 + i)];
        }
        return Array.from({ length: size ** 2 }, (_, i) => {
          const offset = frame * 16 + i;
          if (format === "rgba") return [16 + offset, 32 + offset, 64 + offset, 128 + offset];
          const channels = format === "gray16be" ? 1 : format === "rgb48be" ? 3 : 4;
          return [0x1234, 0x4567, 0x89ab, 0xbdef].slice(0, channels)
            .flatMap(value => [(value + offset) >> 8, (value + offset) & 255]);
        }).flat();
      }).flat());
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.raw", input);
      const outputs: Buffer[] = [];
      for (const expression of [control, coordinates]) {
        volume.writeFileSync("/out.raw", "KEEP");
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-f", "rawvideo", "-pixel_format", format,
            "-video_size", `${size}x${size}`, "-framerate", "4", "-i", "/in.raw",
            "-vf", `crop=2:2:${expression}`, "-fps_mode", "passthrough",
            "-pix_fmt", format, "-f", "rawvideo", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        outputs.push(volume.readFileSync("/out.raw") as Buffer);
      }
      assert.deepEqual(outputs[1], outputs[0]);
      if (format === "rgba" && coordinates === "'if(eq(n,1),0/0,2-n)':0") {
        assert.equal(outputs[1]!.toString("hex"),
          "1222428213234383162646861727478722325292233353932636569627375797304060a0314161a1344464a4354565a5");
      }
      if (format === "rgba" && size === 4 && (coordinates === "nan:nan" || coordinates === "x+1:y")) {
        assert.equal(outputs[1]!.toString("hex"),
          "1525458516264686192949891a2a4a8a2535559526365696293959992a3a5a9a354565a5364666a6394969a93a4a6aaa");
      }
    });
  }
}
