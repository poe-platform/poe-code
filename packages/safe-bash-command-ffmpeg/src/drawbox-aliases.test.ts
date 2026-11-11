import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [options, format, hex] of [
  ["c=white:color=red:c=blue", "rgb24", "0724415e7b98b5d2ef0c294663809d0000ff112e4b6885a2bfdcf91633506d8aa7c4e1fe1b3855728facc9e603203d5a"],
  ["c=red:color=blue", "rgb24", "0724415e7b98b5d2ef0c294663809d0000ff112e4b6885a2bfdcf91633506d8aa7c4e1fe1b3855728facc9e603203d5a"],
  ["c=blue", "rgb24", "0724415e7b98b5d2ef0c294663809d0000ff112e4b6885a2bfdcf91633506d8aa7c4e1fe1b3855728facc9e603203d5a"],
  ["w=1:width=3", "gray", "0724415e7bffffffef0c294663809dba"],
  ["width=1:w=3", "gray", "0724415e7bffffffef0c294663809dba"],
  ["h=1:height=3", "gray", "0724415e7bffb5d2efff294663ff9dba"],
  ["height=1:h=3", "gray", "0724415e7bffb5d2efff294663ff9dba"],
  ["t=1:thickness=0", "gray", "0724415e7b98b5d2ef0c294663809dba"],
  ["thickness=1:t=0", "gray", "0724415e7b98b5d2ef0c294663809dba"]
]) {
  it(`drawbox uses the last alias in ${options}`, async () => {
    const input = Buffer.from(Array.from({ length: format === "rgb24" ? 48 : 16 }, (_, i) => (7 + 29 * i) % 256));
    const volume = Volume.fromJSON({ "/in.raw": input });
    const output: Uint8Array[] = [];
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", format!, "-video_size", "4x4", "-framerate", "2",
        "-i", "/in.raw", "-vf", `drawbox=x=1:y=1:w=1:h=1:t=fill:c=white:${options}`,
        "-fps_mode", "passthrough", "-pix_fmt", format!, "-bitexact", "-f", "rawvideo", "pipe:1"],
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
    assert.equal(Buffer.concat(output).toString("hex"), hex);
  });
}
