import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Complete PCM byte streams from native FFmpeg 7.0.2 for a 12-sample PCM16 ramp.
const floatProduct = "00000000f2c54c3f00000000f2c56c3f00000020582f803f00000000f2c58c3f00000000a57a963f00000020582fa03f000000408d07a63f00000000f2c5ac3f000000204335b23f00000000a57ab63f000000c01e33bb3f00000020582fc03f";
const doubleProduct = "00000000f2c54c3f00000000f2c56c3f00000020582f803f00000000f2c58c3f00000010a57a963f00000020582fa03f000000488d07a63f00000000f2c5ac3f000000244335b23f00000010a57ab63f000000c41e33bb3f00000020582fc03f";

for (const [first, second, format, expected] of [
  ["", "", "f64le", floatProduct],
  ["", ":precision=double", "f64le", floatProduct],
  ["", "", "f32le", "902f663a902f663bc17a013c902f663c28d5b33cc17a013d6a3c303d902f663d19aa913d28d5b33df698d93dc17a013e"],
  [":precision=double", "", "f64le", doubleProduct]
]) {
  it(`amultiply rounds at branch precision (${first || "float"}, ${second || "float"}) before ${format} output`, async () => {
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from({ length: 12 }, (_, i) => (i + 1) * 1000 / 32768)] })) });
    const stdout: Buffer[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav", "-filter_complex",
        `[0:a]asplit[x][y];[x]volume=0.971${first}[a];[y]volume=0.971${second}[b];[a][b]amultiply,anull[o]`,
        "-map", "[o]", "-f", format, "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.equal(Buffer.concat(stdout).toString("hex"), expected);
  });
}
