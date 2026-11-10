import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Timestamp pairs from FFmpeg 7.0.2 with ten mono PCM16 samples at 8 kHz.
for (const complex of [false, true]) {
  for (const [expression, timestamps] of [
    ["NAN", [["NOPTS", "NOPTS"], ["NOPTS", "NOPTS"], ["NOPTS", "NOPTS"], ["NOPTS", "NOPTS"]]],
    ["PTS", [["0", "0"], ["3", "0.000375"], ["6", "0.00075"], ["9", "0.001125"]]]
  ] as const) {
    it(`formats ashowinfo timestamps after asetpts=${expression} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(20);
      for (let i = 0; i < 10; i++) input.writeInt16LE(101 + (13 * i) % 7000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.dat": "KEEP" });
      const chain = `asetnsamples=n=3:p=0,asetpts=${expression},ashowinfo`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "info", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
          "-f", "s16le", "/out.dat"],
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
      assert.deepEqual(volume.readFileSync("/out.dat"), input);
      assert.deepEqual(stderr.split("\n").filter(line => line.startsWith("[ashowinfo]")).map(line => {
        const fields = line.split(" ");
        return [fields.find(field => field.startsWith("pts:"))!.slice(4),
          fields.find(field => field.startsWith("pts_time:"))!.slice(9)];
      }), timestamps);
    });
  }
}
