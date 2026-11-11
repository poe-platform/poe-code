import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const filter of ["null", "setsar=1,showinfo", "framestep=2"]) {
  for (const pixelFormat of ["gray", "gray8"]) {
    for (const target of ["pipe:1", "/out.y4m"]) {
      it(`writes monochrome Y4M for ${pixelFormat} with ${filter} to ${target}`, async () => {
        const input = Buffer.from([13, 20, 27, 34]);
        const volume = Volume.fromJSON({ "/in.raw": input });
        const chunks: Uint8Array[] = [];
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-loglevel", "info", "-f", "rawvideo", "-pix_fmt", "gray",
            "-s", "2x2", "-r", "6", "-i", "/in.raw", "-vf", filter,
            "-fps_mode", "passthrough", "-pix_fmt", pixelFormat, "-f", "yuv4mpegpipe", target],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        const output = target === "pipe:1" ? Buffer.concat(chunks) : volume.readFileSync(target) as Buffer;
        const end = output.indexOf(10) + 1;
        const header = output.subarray(0, end).toString().trim().split(" ");
        assert.ok(header.includes("Cmono"), header.join(" "));
        assert.ok(header.includes("XCOLORRANGE=FULL"), header.join(" "));
        if (filter.startsWith("setsar")) assert.ok(header.includes("A1:1"));
        assert.deepEqual(output.subarray(end), Buffer.concat([Buffer.from("FRAME\n"), input]));
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
