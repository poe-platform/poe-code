import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 reference: ten PCM16 samples split into frames of 3, 3, 3 and 1.
const samples = [101, 114, 127, 140, 153, 166, 179, 192, 205, 218];
for (const complex of [false, true]) {
  for (const [filter, expected] of [
    ["aselect='gt(st(0,ld(0)+1),2)'", samples.slice(6)],
    ["aselect='eq(ld(0),0)'", samples],
    ["aselect='st(0,n);eq(ld(0),1)'", samples.slice(3, 6)],
    ["aselect='eq(n,2)'", samples.slice(6, 9)],
    ["aselect='st(0,ld(0)+1);st(9,ld(9)+2);eq(ld(9),6)*eq(ld(0),3)'", samples.slice(6, 9)],
    ["aselect='if(eq(n,1),st(0,ld(0)+1),0);eq(ld(0),1)'", samples.slice(3)],
    ["aselect='gt(st(0,ld(0)+1),2)',aselect='eq(ld(0),0)'", samples.slice(6)],
    ["atrim=end_sample=0,aselect='st(0,n);eq(ld(0),1)'", []],
    ["aselect='st(0,1);unknown'", null],
    ["atrim=end_sample=0,aselect='st(0,1);unknown'", null]
  ] as const) {
    it(`aselect retains local registers: ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(samples.length * 2);
      for (const [i, sample] of samples.entries()) input.writeInt16LE(sample, i * 2);
      const command = createFfmpegCommand();
      // Reusing a command must start each execution with fresh filter registers.
      for (let run = 0; run < 2; run++) {
        const volume = Volume.fromJSON({ "/in.raw": input, "/out.dat": "KEEP" });
        const before = volume.toJSON();
        const chain = `asetnsamples=n=3:p=0,${filter}`;
        let stderr = "";
        const result = await command.execute({
          args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${chain}[o]`, "-map", "[o]"] : ["-af", chain]),
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
        if (expected === null) {
          assert.notEqual(result.exitCode, 0);
          assert.ok(stderr.includes("aselect:"), stderr);
          assert.deepEqual(volume.toJSON(), before);
        } else {
          assert.equal(result.exitCode, 0, stderr);
          const pcm = Buffer.alloc(expected.length * 2);
          for (const [i, sample] of expected.entries()) pcm.writeInt16LE(sample, i * 2);
          assert.deepEqual(volume.readFileSync("/out.dat"), pcm);
        }
      }
    });
  }
}
