import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const mode of ["difference", "6", "3+3", "difference+0", "bogus", "999", "6+"]) {
  it(`tblend evaluates all_mode=${mode} before selecting the operation`, async () => {
    const samples = [[50, 30, 212], [120, 180, 60], [120, 180, 60], [80, 140, 190]];
    const input = Buffer.concat([Buffer.from("YUV4MPEG2 W2 H2 F4:1 Ip A1:1 C444\n"),
      ...samples.flatMap(frame => [Buffer.from("FRAME\n"), ...frame.map(value => Buffer.alloc(4, value))])]);
    const volume = Volume.fromJSON({ "/in.y4m": input, "/o.raw": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", `tblend=all_mode=${mode}`,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/o.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    if (["bogus", "999", "6+"].includes(mode)) {
      assert.notEqual(result.exitCode, 0);
      assert.match(Buffer.concat(errors).toString(), /tblend:/);
      assert.equal(volume.readFileSync("/o.raw", "utf8"), "KEEP");
    } else {
      assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      assert.equal((volume.readFileSync("/o.raw") as Buffer).toString("hex"),
        "464646469696969698989898000000000000000000000000282828282828282882828282");
    }
  });
}
