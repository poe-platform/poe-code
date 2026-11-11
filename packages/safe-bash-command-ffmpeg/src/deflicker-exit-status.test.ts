import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native Linux FFmpeg 7.0.2 statuses and complete rawvideo output.
for (const [option, status, hex] of [
  ["s=1", 222, ""],
  ["size=130", 222, ""],
  ["m=bad", 234, ""],
  ["q=1", 8, ""],
  ["size=4::m=gm", 234, ""],
  ["size=4:m=gm::", 234, ""],
  ["size=4:m=gm:", 0, "169fff004993dc3d76b62b6bab2161a12797ff1695ff0481a8fa489ae93a8bdc"],
  ["size=4:m=gm", 0, "169fff004993dc3d76b62b6bab2161a12797ff1695ff0481a8fa489ae93a8bdc"],
  ["s=2", 0, "138bff0052a4f64497e93789ac2161a21d70c31085f40473a7f94799e93a8bdc"]
] as const) {
  it(`matches native deflicker=${option} status and raw frame bytes`, async () => {
    const input = Buffer.from("0d5eaf0051a2f34495e63788d92a7bcc1d6ebf1061b20354a5f64798e93a8bdc", "hex");
    const volume = Volume.fromJSON({ "/in.raw": input });
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "rawvideo", "-pixel_format", "gray", "-video_size", "2x2",
        "-framerate", "2", "-i", "/in.raw", "-vf", `deflicker=${option}`,
        "-fps_mode", "passthrough", "-pix_fmt", "gray", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(data: Uint8Array) { stdout.push(data); } },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, status, stderr);
    assert.equal(Buffer.concat(stdout).toString("hex"), hex);
    if (status === 0) assert.equal(stderr, "");
    else assert.ok(stderr.includes("deflicker:"), stderr);
    assert.deepEqual(volume.readFileSync("/in.raw"), input);
  });
}
