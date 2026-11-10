import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const samples = [[50, 30, 212], [120, 180, 60], [120, 180, 60], [80, 140, 190]];

for (const y4m of [false, true]) {
  for (const suffix of ["", ":", "::", ":unknown=1", ":all_opacity=1.5", ":invalid"]) {
    it(`handles tblend=all_mode=difference${suffix} with ${y4m ? "YUV" : "RGB"} input`, async () => {
      const input = y4m
        ? Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
          ...samples.flatMap(frame => [Buffer.from("FRAME\n"), Buffer.from(frame.flatMap(value => Array<number>(4).fill(value)))])])
        : Buffer.from(samples.flatMap(frame => Array.from({ length: 4 }, () => frame).flat()));
      const volume = Volume.fromJSON({ "/in": input, "/out": "KEEP" });
      const run = async (filter: string) => {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", ...(y4m ? [] : ["-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "2x2", "-framerate", "4"]),
            "-i", "/in", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", y4m ? "yuv444p" : "rgb24", "-f", "rawvideo", "/out"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        return { ...result, stderr };
      };
      const result = await run(`tblend=all_mode=difference${suffix}`);
      if (suffix !== "" && suffix !== ":") {
        assert.notEqual(result.exitCode, 0, result.stderr);
        assert.ok(result.stderr.includes("tblend:"), result.stderr);
        assert.equal(volume.readFileSync("/out").toString(), "KEEP");
      } else {
        assert.equal(result.exitCode, 0, result.stderr);
        const output = volume.readFileSync("/out");
        assert.equal(output.length, 36);
        const control = await run("tblend=all_mode=difference");
        assert.equal(control.exitCode, 0, control.stderr);
        assert.deepEqual(output, volume.readFileSync("/out"));
        if (!y4m) {
          assert.deepEqual(output, Buffer.from([[70, 150, 152], [0, 0, 0], [40, 40, 130]]
            .flatMap(frame => Array.from({ length: 4 }, () => frame).flat())));
        }
      }
      assert.deepEqual(volume.readFileSync("/in"), input);
    });
  }
}
