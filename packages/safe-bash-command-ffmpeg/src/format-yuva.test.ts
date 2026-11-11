import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: RGBA -> yuva444p -> RGBA, including alpha rounding.
for (const filter of ["format=yuva444p", "format=pix_fmts=yuva444p", "format=yuva444p,format=yuva444p,format=rgba", "format=rgba"]) {
  it(`converts raw RGBA through ${filter}`, async () => {
    const input = Buffer.from("4080c0ff4080c0800a141e00ff002040", "hex");
    const volume = Volume.fromJSON({ "/in.raw": input });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", "2x2", "-framerate", "4",
        "-i", "/in.raw", "-vf", filter, "-fps_mode", "passthrough", "-pix_fmt", "rgba", "-bitexact", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    assert.equal(Buffer.concat(output).toString("hex"), filter === "format=rgba"
      ? input.toString("hex") : "4080c1ff4080c1810b141f00ff002040");
  });
}
