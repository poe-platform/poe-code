import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete native FFmpeg 7.0.2 rawvideo outputs for each plane.
const fixtures = [
  [10, "2d01320137013c01410146014b015001f5010702f9010b02", [
    ["transpose=clock", "41012d01460132014b01370150013c01f5010702f9010b02"],
    ["hflip", "3c01370132012d0150014b01460141010702f5010b02f901"],
    ["vflip", "410146014b0150012d01320137013c01f5010702f9010b02"]
  ]],
  [16, "4d4fc2503752ac53215596560b588059017d3582057d3982", [
    ["transpose=clock", "21554d4f9656c2500b5837528059ac53017d3582057d3982"],
    ["hflip", "ac533752c2504d4f80590b58965621553582017d3982057d"],
    ["vflip", "215596560b5880594d4fc2503752ac53017d3582057d3982"]
  ]]
] as const;

for (const [depth, input, permutations] of fixtures) {
  const cases = [...permutations, ...[
    "null", "transpose=clock:landscape", "transpose=clock,transpose=cclock",
    "hflip,hflip", "vflip,vflip"
  ].map(filter => [filter, input] as const)];
  for (const [filter, expected] of cases) {
    it(`${filter} preserves all ${depth}-bit YUV420 samples`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from(input, "hex") });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "rawvideo", "-pixel_format", `yuv420p${depth}le`,
          "-video_size", "4x2", "-i", "/in.raw", "-vf", filter, "-frames:v", "1",
          "-pix_fmt", `yuv420p${depth}le`, "-f", "rawvideo", "/out.raw"],
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
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      assert.equal((volume.readFileSync("/in.raw") as Buffer).toString("hex"), input);
    });
  }
}
