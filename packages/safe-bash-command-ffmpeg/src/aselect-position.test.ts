import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 reference: mono PCM16 packets start at bytes 0, 1024 and 2048.
for (const complex of [false, true]) {
  for (const [samples, filter, start, end, hash] of [
    [1200, "aselect=eq(pos\\,1024)", 512, 1024, "c4452ff94f87d3c3b8c414ab94b548d44b002959cb6f305a75eadf0ee91511c0"],
    [1200, "aselect=eq(pos\\,2048)", 1024, 1200, "3b05c773b4e80f6cb76622f2eed7ae68053d3b9d19330fb046ff07834101b4cd"],
    [1200, "aselect='eq(pos,0)'", 0, 512, "93de1ebff6f0c640c7bb8914451ee4f6e8104e839856c4f2f43dd0eefc4dd8f0"],
    [1200, "aselect=eq(n\\,1)", 512, 1024, "c4452ff94f87d3c3b8c414ab94b548d44b002959cb6f305a75eadf0ee91511c0"],
    [10, "asetnsamples=n=3:p=0,aselect='eq(pos,0)'", 0, 10, undefined],
    [10, "asetnsamples=n=3:p=0,aselect='eq(n,1)'", 3, 6, undefined],
    [1200, "aselect='gte(pos,1024)',aselect='eq(pos,2048)'", 1024, 1200, undefined],
    [1200, "aselect='eq(pos,9999)'", 0, 0, undefined],
    [10, "atrim=end_sample=0,aselect='isnan(pos)'", 0, 0, undefined]
  ] as const) {
    it(`aselect reads packet byte positions: ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(samples * 2);
      for (let i = 0; i < samples; i++) input.writeInt16LE(101 + (13 * i) % 7000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out.dat": "KEEP" });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[o]`, "-map", "[o]"] : ["-af", filter]),
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
      const output = volume.readFileSync("/out.dat") as Buffer;
      assert.deepEqual(output, input.subarray(start * 2, end * 2));
      if (hash) assert.equal(createHash("sha256").update(output).digest("hex"), hash);
    });
  }
}
