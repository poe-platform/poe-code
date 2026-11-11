import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: successful thread expressions select the right sample, 03 00.
for (const [expression, status] of [
  ["st(0\\,1)", 0], ["ld(0)", 0], ["st(0\\,1)+ld(0)", 0],
  ["1", 0], ["0", 0], ["oops", 234],
  ["st(0\\,-1)", 222], ["st(0\\,2147483648)", 222]
] as const) {
  for (const complex of [false, true]) {
    it(`evaluates pan threads=${expression} (${complex ? "graph" : "simple"})`, async () => {
      const input = Buffer.from("01000300", "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `pan=mono|c0=c1:threads=${expression}`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
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
      if (status === 0) assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from("0300", "hex"));
      else assert.equal(volume.existsSync("/out.raw"), false);
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
