import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 preserves eight input samples and appends three silent samples.
for (const [expression, status] of [
  ["'st(0,1);ld(0)'", 0], ["'st(0,1)':threads='ld(0)-1'", 222], ["st(0\\,1)", 0], ["ld(0)", 0], ["st(0\\,1)+ld(0)", 0],
  ["1", 0], ["0", 0], ["oops", 234],
  ["st(0\\,-1)", 222], ["st(0\\,2147483648)", 222]
] as const) {
  for (const complex of [false, true]) {
    it(`evaluates apad threads=${expression} (${complex ? "graph" : "simple"})`, async () => {
      const input = Buffer.from("6400c8002c019001f4015802bc022003", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `apad=pad_len=3:threads=${expression}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-t", "0.008", "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, status, stderr);
      if (status === 0) {
        assert.equal(stderr, "");
        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.concat([input, Buffer.alloc(6)]));
      }
      else assert.equal(volume.existsSync("/out.raw"), false);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
