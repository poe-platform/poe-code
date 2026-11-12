import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: preserve both PGM payloads when frame dimensions change.
for (const source of ["file", "stdin"]) {
  for (const [name, options, expected] of [
    ["original dimensions", ["-noautoscale"], "1122334455"],
    ["default scaling", [], "11223355"],
    ["explicit scaling", ["-noautoscale", "-vf", "scale=2:1"], "11223355"],
    ["scaling reset for the next output", ["-noautoscale", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"], "112233445511223355"],
    ["first frame only", ["-noautoscale", "-frames:v", "1"], "1122"],
    ["default first-frame control", ["-frames:v", "1"], "1122"]
  ] as const) {
    it(`preserves PGM pixels with ${name} from ${source}`, async () => {
      const input = Buffer.from("50350a3220310a3235350a112250350a3320310a3235350a334455", "hex");
      const volume = Volume.fromJSON({ "/in.pgm": input });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "image2pipe", "-i", source === "file" ? "/in.pgm" : "pipe:0",
          ...options, "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { if (source === "stdin") yield input; })(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), expected);
    });
  }
}
