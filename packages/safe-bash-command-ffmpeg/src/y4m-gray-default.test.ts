import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const pixelFormat of ["gray", "gray8"]) {
  for (const outputFormat of [undefined, "gray", "yuv420p"]) {
    for (const target of ["pipe:1", "/out.y4m"]) {
      it(`preserves raw ${pixelFormat} in Y4M with output ${outputFormat ?? "default"} to ${target}`, async () => {
        const input = Buffer.from([1, 1, 1, 1, 0, 64, 128, 255]);
        const volume = Volume.fromJSON({ "/in.raw": input });
        const chunks: Uint8Array[] = [];
        const errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "rawvideo", "-framerate", "4", "-pixel_format", pixelFormat,
            "-video_size", "2x2", "-i", "/in.raw", ...(outputFormat ? ["-pix_fmt", outputFormat] : []),
            "-f", "yuv4mpegpipe", target],
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
        assert.equal(Buffer.concat(errors).toString(), "");
        const output = target === "pipe:1" ? Buffer.concat(chunks) : volume.readFileSync(target) as Buffer;
        const end = output.indexOf(10) + 1;
        const header = output.subarray(0, end).toString().trim().split(" ");
        for (const token of ["YUV4MPEG2", "W2", "H2", "F4:1", "Ip",
          outputFormat === "yuv420p" ? "C420jpeg" : "Cmono"]) {
          assert.ok(header.includes(token), header.join(" "));
        }
        assert.equal(header.includes("XCOLORRANGE=FULL"), outputFormat !== "yuv420p", header.join(" "));
        const frames = outputFormat === "yuv420p"
          ? [Buffer.from([17, 17, 17, 17, 128, 128]), Buffer.from([16, 71, 126, 235, 128, 128])]
          : [input.subarray(0, 4), input.subarray(4)];
        assert.deepEqual(output.subarray(end), Buffer.concat(frames.flatMap(frame => [Buffer.from("FRAME\n"), frame])));
        assert.deepEqual(volume.readFileSync("/in.raw"), input);
      });
    }
  }
}
