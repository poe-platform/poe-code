import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const payload = Buffer.concat([16, 235, 16, 235, 235, 16, 235].map(y =>
  Buffer.from([y, y, y, y, 128, 128, 128, 128, 128, 128, 128, 128])));

for (const [field, classification] of [["p", "PROGRESSIVE"], ["t", "TOPFIRST"], ["b", "BOTTOMFIRST"], ["?", "PROGRESSIVE"]] as const) {
  for (const selected of ["PROGRESSIVE", "TOPFIRST", "BOTTOMFIRST", "0", "1", "2", "null"]) {
    it(`select classifies Y4M I${field} as ${classification}: ${selected}`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      const frames = Array.from({ length: 7 }, (_, index) => Buffer.concat([
        Buffer.from("FRAME\n"), payload.subarray(index * 12, (index + 1) * 12)
      ]));
      volume.writeFileSync("/in.y4m", Buffer.concat([
        Buffer.from(`YUV4MPEG2 W2 H2 F5:1 I${field} A1:1 C444\n`), ...frames
      ]));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf",
          selected === "null" ? "null" : `select=eq(interlace_type\\,${selected})`,
          "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const matches = selected === "null" || selected === classification ||
        selected === String(["PROGRESSIVE", "TOPFIRST", "BOTTOMFIRST"].indexOf(classification));
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.deepEqual(output, matches ? payload : Buffer.alloc(0));
      assert.equal(createHash("sha256").update(output).digest("hex"), matches
        ? "a30dcc48f6f88e4e735fa8fcf8906d92f28bb60081a61a0a2c8a1e0b098b514d"
        : "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });
  }
}

for (const [filter, counts] of [
  ["tinterlace=interleave_top", [0, 3, 0]],
  ["telecine=first_field=top", [3, 5, 0]],
  ["telecine=first_field=bottom", [3, 0, 5]]
] as const) {
  for (const [index, classification] of ["PROGRESSIVE", "TOPFIRST", "BOTTOMFIRST"].entries()) {
    it(`select reads ${classification} after ${filter}`, async () => {
      const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
      volume.writeFileSync("/in.y4m", Buffer.concat([
        Buffer.from("YUV4MPEG2 W2 H2 F5:1 Ip A1:1 C444\n"),
        ...Array.from({ length: 7 }, () => Buffer.concat([Buffer.from("FRAME\n"), Buffer.alloc(12, 128)]))
      ]));
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.y4m", "-vf",
          `${filter},select=eq(interlace_type\\,${classification})`,
          "-fps_mode", "passthrough", "-pix_fmt", "yuv444p", "-f", "rawvideo", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal((volume.readFileSync("/out.raw") as Buffer).length, counts[index]! * 12);
    });
  }
}
