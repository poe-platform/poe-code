import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const color of [false, true]) {
  for (const mode of ["4", "interleave_top", "mode=4", "mode=interleave_top"]) {
    for (const suffix of ["", ":", "::", ":unknown=1", ":flags=1", ":5"]) {
      const filter = `tinterlace=${mode}${suffix}`;
      it(`handles ${filter} on ${color ? "color" : "gray"} YUV444 input`, async () => {
        const frames = Array.from({ length: 6 }, (_, i) => Buffer.from([
          ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(32 + 24 * i + 3 * y)).flat(),
          ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(color ? 35 + 9 * i + y : 128)).flat(),
          ...Array.from({ length: 4 }, (_, y) => Array<number>(4).fill(color ? 216 - 8 * i - y : 128)).flat()
        ]));
        const input = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H4 F6:1 Ip A1:1 C444\n"),
          ...frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])]);
        const volume = Volume.fromJSON({ "/in.y4m": input, "/out.y4m": "KEEP" });
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", filter,
            "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "yuv4mpegpipe", "/out.y4m"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        const output = volume.readFileSync("/out.y4m") as Buffer;
        if (suffix !== "" && suffix !== ":") {
          assert.notEqual(result.exitCode, 0, stderr);
          assert.ok(stderr.includes("tinterlace:"), stderr);
          assert.equal(output.toString(), "KEEP");
          return;
        }
        assert.equal(result.exitCode, 0, stderr);
        const headerEnd = output.indexOf(10) + 1;
        assert.equal(output.subarray(0, headerEnd).toString(), "YUV4MPEG2 W4 H4 F3:1 It A1:1 C444\n");
        assert.equal(output.length, headerEnd + 3 * (6 + 48));
        const planes = Array.from({ length: 3 }, (_, i) => {
          const start = headerEnd + i * (6 + 48);
          assert.equal(output.subarray(start, start + 6).toString(), "FRAME\n");
          return output.subarray(start + 6, start + 6 + 48);
        });
        assert.deepEqual(planes.slice(0, 2).map(frame => [frame[0], frame[4], frame[8], frame[12]]),
          [[32, 59, 38, 65], [80, 107, 86, 113]]);
        assert.equal(createHash("sha256").update(Buffer.concat(planes)).digest("hex"), color
          ? "616db2babbab6c199900ab2190c73a4d3840f8642b486ee453e2cd8cacefa812"
          : "39d0d1885b28f1a97ef6bb6a045eda20fdc2f3951e23bcc59c7cc8d9ab983460");
      });
    }
  }
}
