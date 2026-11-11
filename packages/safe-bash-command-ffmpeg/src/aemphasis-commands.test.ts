import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Complete PCM16 tails from FFmpeg 7.0.2, following two unchanged four-sample frames.
for (const [commands, tail] of [
  ["", "43fc91ff0e01dcfe92fc4eff4401b2fe"],
  ["0.001 aemphasis@eq type riaa", "f2f3b7f9a0fc90fb18f984f9f1fbeefa"],
  ["0.001 aemphasis@eq mode production", "2dfa37058afd4dffbcfaea0339ff80fd"],
  ["0.001 aemphasis@eq type bad", "43fc91ff0e01dcfe92fc4eff4401b2fe"],
  ["0.001 aemphasis@eq mode 2", "43fc91ff0e01dcfe92fc4eff4401b2fe"],
  ["0.00075 aemphasis@eq type 3", "f2f3b7f9a0fc90fb18f984f9f1fbeefa"],
  ["0.001 aemphasis@eq mode 1;0.0015 aemphasis@eq mode 2", "2dfa37058afd4dffbcfaea0339ff80fd"],
  ["0.001 aemphasis@eq type riaa;0.0015 aemphasis@eq type bad", "f2f3b7f9a0fc90fb18f984f9f1fbeefa"]
] as const) {
  for (const channels of [1, 2]) {
    for (const complex of [false, true]) {
      it(`matches scheduled aemphasis PCM: ${commands || "control"} (${channels}ch, ${complex ? "graph" : "simple"})`, async () => {
        const input = Buffer.alloc(16 * channels * 2);
        const mono = Buffer.from(`4102bffef30046ff05fce4ffb30034ff${tail}`, "hex");
        const expected = Buffer.alloc(input.length);
        for (let sample = 0; sample < 16; sample++) {
          for (let channel = 0; channel < channels; channel++) {
            const offset = (sample * channels + channel) * 2;
            input.writeInt16LE([2000, -3000, 4000, -5000][sample % 4]!, offset);
            expected.writeInt16LE(mono.readInt16LE(sample * 2), offset);
          }
        }
        const volume = Volume.fromJSON({ "/in.raw": input });
        const filter = `asetnsamples=n=4:p=0,${commands ? `asendcmd=c='${commands}',` : ""}aemphasis@eq=level_out=0.5`;
        const chunks: Buffer[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", String(channels), "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            "-f", "s16le", "pipe:1"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(Buffer.concat(chunks), expected);
      });
    }
  }
}
