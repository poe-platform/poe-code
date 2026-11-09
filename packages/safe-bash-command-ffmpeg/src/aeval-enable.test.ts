import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const complex of [false, true]) {
  for (const [enable, enabled] of [["0", false], ["1", true], ["-1", true],
    ["0.1", false], ["lt(n\\,1)", true], ["gt(t\\,0)", false]] as const) {
    it(`aeval enable=${enable} preserves stereo samples when bypassed (${complex ? "graph" : "simple"})`, async () => {
      const samples = [110, -550, 220, -660, 330, -770, 440, -880];
      const input = Buffer.alloc(samples.length * 2);
      samples.forEach((sample, i) => input.writeInt16LE(sample, i * 2));
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.raw", input);
      let stderr = "";
      const filter = `aeval=0-val(ch):c=same:enable=${enable}`;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(complex ? ["-filter_complex", `[0:a]${filter}[s]`, "-map", "[s]"] : ["-af", filter]),
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
      assert.equal(result.exitCode, 0, stderr);
      const output = volume.readFileSync("/out.raw") as Buffer;
      assert.equal(output.length, input.length);
      assert.deepEqual(samples.map((_, i) => output.readInt16LE(i * 2)),
        samples.map(sample => enabled ? -sample : sample));
    });
  }
}
