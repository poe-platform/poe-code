import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2, 16 mono PCM16 samples of 16384 at 8 kHz.
const wet = "0040a13600205f0900005f090020a136";
const dry = "0040".repeat(8);
for (const [initial, replacement, expected] of [
  ["1", "ld(0)", wet + dry],
  ["1", "random(0)", wet + "0040a13600205f09" + "0040".repeat(4)],
  ["st(0,1)", "ld(0)", wet + dry],
  ["random(0)", "random(0)", "0040a13600205f09" + "0040".repeat(4) + "00005f090020a136" + "0040".repeat(4)],
  ["1", "0", wet + dry],
  ["1", "1", wet.repeat(2)],
  ["1", "bad", wet.repeat(2)],
  ["st(0,1)", "bad", wet.repeat(2)]
] as const) {
  for (const graph of [false, true]) {
    it(`tremolo replaces ${initial} with ${replacement} using fresh state (graph ${graph})`, async () => {
      const volume = Volume.fromJSON({ "/in.raw": Buffer.from("0040".repeat(16), "hex") });
      const filter = `asetnsamples=n=4:p=0,asendcmd=c='0.001 tremolo@t enable ${replacement}',tremolo@t=f=1000:d=1:enable='${initial}'`;
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[a]`, "-map", "[a]"] : ["-af", filter]),
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
      assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(expected, "hex"));
    });
  }
}
