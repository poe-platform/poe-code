import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 references, including the equivalent atrim control.
for (const complex of [false, true]) {
  for (const [filter, expected] of [
    ["asetnsamples=n=4:p=0,aselect=0,adelay=3S|0S,aselect='lt(t,0)'",
      "000000000000000000000000"],
    ["asetnsamples=n=4:p=0,aselect=0,adelay=3S|0S,atrim=start=0.002:end=0.005", ""],
    ["asetnsamples=n=4:p=0,atrim=end_sample=0,adelay=3S|0S,aselect='lt(t,0)'",
      "000000000000000000000000"],
    ["asetnsamples=n=4:p=0,atrim=end_sample=0,adelay=3S|0S,atrim=start=0.002:end=0.005", ""]
  ] as const) {
    it(`preserves delay tail timing after all input is discarded: ${filter} (${complex ? "complex" : "simple"})`, async () => {
      const input = Buffer.alloc(11 * 4);
      for (let i = 0; i < 11; i++) {
        input.writeInt16LE((i + 1) * 100, i * 4);
        input.writeInt16LE((i + 1) * -100, i * 4 + 2);
      }
      const volume = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "1000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-c:a", "pcm_s16le", "-f", "s16le", "/out"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out") as Buffer;
      assert.equal(output.toString("hex"), expected);
    });
  }
}
