import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = "4080c0ff4080c0800a141e00ff002040";
for (const [filter, expected] of [
  ["lutrgb=a=negval", "4080c0004080c07f0a141effff0020bf"],
  ["lutrgb=c0=val/2", "2080c0ff2080c08005141e007f002040"],
  ["lutrgb=val/2", "2080c0ff2080c08005141e007f002040"],
  ["lutrgb=r=val/2", "2080c0ff2080c08005141e007f002040"],
  ["negate=components=a", "4080c0004080c07f0a141effff0020bf"],
  ["lutrgb", input],
  ["lutrgb=r=val/2:a=negval", "2080c0002080c07f05141eff7f0020bf"],
  ["lutrgb=g=maxval:b=minval", "40ff00ff40ff00800aff0000ffff0040"],
  ["lutrgb=r=val*2:g=-1", "8000c0ff8000c08014001e00ff002040"],
  ["lutrgb=r=w+h", "0480c0ff0480c08004141e0004002040"],
  ["lutrgb=r=unknown", null],
  ["lutrgb=r=val/", null],
  ["lutrgb=unknown=val", null]
] as const) {
  it(`matches FFmpeg ${filter}`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "preserved" });
    volume.writeFileSync("/in.raw", Buffer.from(input, "hex"));
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba",
        "-s", "2x2", "-r", "1", "-i", "/in.raw",
        "-vf", filter, "-pix_fmt", "rgba", "-f", "rawvideo", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (expected === null) {
      assert.notEqual(result.exitCode, 0);
      assert.ok(Buffer.concat(errors).toString().includes("lutrgb:"));
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "preserved");
    } else {
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    }
    assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), input);
  });
}
