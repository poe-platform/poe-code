import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

it("tinterlace expressions match direct mode 4 Y4M bytes and timing", async () => {
  let control: Buffer | undefined;
  for (const mode of ["4", "2+2", "4.4"]) {
    const input = Buffer.concat([
      Buffer.from("YUV4MPEG2 W4 H4 F6:1 Ip A1:1 C444\n"),
      ...Array.from({ length: 6 }, (_, i) => [Buffer.from("FRAME\n"),
        Buffer.from(Array.from({ length: 48 }, (_, n) => n < 16 ? 32 + 24 * i + 3 * Math.floor(n / 4) : 128))]).flat()
    ]);
    const volume = Volume.fromJSON({ "/in.y4m": input, "/out.y4m": "KEEP" });
    const errors: Uint8Array[] = [];
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf", `tinterlace=mode=${mode}`,
        "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "yuv4mpegpipe", "/out.y4m"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
    const bytes = volume.readFileSync("/out.y4m") as Buffer;
    const header = bytes.subarray(0, bytes.indexOf(10)).toString().split(" ");
    assert.equal(header.find(token => token.startsWith("I")), "It");
    const [numerator, denominator] = header.find(token => token.startsWith("F"))!.slice(1).split(":").map(Number);
    assert.equal(numerator! / denominator!, 3);
    const payload = bytes.subarray(bytes.indexOf(10) + 1);
    assert.equal(payload.length, 3 * (6 + 48));
    const planes = [];
    for (let offset = 0; offset < payload.length; offset += 54) {
      assert.equal(payload.subarray(offset, offset + 6).toString(), "FRAME\n");
      planes.push(payload.subarray(offset + 6, offset + 54));
    }
    assert.equal(createHash("sha256").update(Buffer.concat(planes)).digest("hex"),
      "39d0d1885b28f1a97ef6bb6a045eda20fdc2f3951e23bcc59c7cc8d9ab983460");
    if (control) assert.deepEqual(bytes, control);
    else control = bytes;
    assert.deepEqual(volume.readFileSync("/in.y4m"), input);
  }
});
