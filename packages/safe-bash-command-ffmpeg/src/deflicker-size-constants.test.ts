import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "0d5eaf0051a2f34495e63788d92a7bcc1d6ebf1061b20354a5f64798e93a8bdc";

// FFmpeg 7.0.2 rejects mode constants in size expressions with status 234.
for (const [options, expected] of [
  ["size=median", undefined],
  ...["am", "gm", "hm", "qm", "cm", "pm", "median"].flatMap(mode =>
    ["size=", "s=", ""].map(prefix => [`${prefix}${mode}+2`, undefined] as const)),
  ["size=6", "1496ff004a94df3e89d3327dc72670bb2daeff19a0ff048ba8fb489be93a8bdc"],
  ["size=default+1", "1496ff004a94df3e89d3327dc72670bb2daeff19a0ff048ba8fb489be93a8bdc"],
  ["s=3:m=gm", "1494ff0053a6f9457fc42f749b1e57912488ed138eff047ba7fa489ae93a8bdc"],
  ["s=3:mode=gm", "1494ff0053a6f9457fc42f749b1e57912488ed138eff047ba7fa489ae93a8bdc"]
] as const) {
  it(`scopes deflicker mode constants for ${options}`, async () => {
    const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray",
        "-video_size", "2x2", "-framerate", "2", "-i", "/in.raw",
        "-vf", `deflicker=${options}`, "-fps_mode", "passthrough",
        "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, expected === undefined ? 234 : 0, stderr);
    assert.equal(Buffer.concat(stdout).toString("hex"), expected ?? "");
    if (expected === undefined) assert.ok(stderr.includes("deflicker: invalid"), stderr);
    else assert.equal(stderr, "");
    assert.equal(volume.readFileSync("/in.raw").toString("hex"), input);
  });
}
