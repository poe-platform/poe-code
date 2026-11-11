import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const graph of [false, true]) {
  for (const [repetitions, frames, level] of [[1, undefined, "info"], [125, undefined, "info"],
    [1, 0, "info"], [1, undefined, "warning"]] as const) {
    it(`attributes every volumedetect line to its instance: graph=${graph}, repeats=${repetitions}, frames=${frames}, level=${level}`, async () => {
      const input = Buffer.from("00400000002000100008000400020001".repeat(repetitions), "hex");
      const fs = Volume.fromJSON({ "/in.raw": input });
      let stderr = "";
      const output: Uint8Array[] = [];
      const filter = "volumedetect@before,volume=0.25,volumedetect@after=";
      const result = await createFfmpegCommand().execute({
        args: ["-v", level, "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...(frames === undefined ? [] : ["-frames:a", String(frames)]), "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { output.push(bytes.slice()); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(Buffer.concat(output).toString("hex"), frames === 0 ? ""
        : "00100000000800040002000180004000".repeat(repetitions));
      const lines = stderr.trim().split("\n").filter(Boolean);
      if (level === "warning") {
        assert.deepEqual(lines, []);
        return;
      }
      for (const [instance, mean, peak, bin] of [
        ["before", "-13.8", "-6.0", 6], ["after", "-25.8", "-18.1", 18]
      ] as const) {
        const measurements: string[] = ["n_samples: 0", `n_samples: ${frames === 0 ? 0 : repetitions * 8}`];
        if (frames !== 0) {
          measurements.push(`mean_volume: ${mean} dB`, `max_volume: ${peak} dB`);
          if (repetitions === 125) measurements.push(`histogram_${bin}db: 125`);
        }
        assert.deepEqual(lines.filter(line => line.includes(`volumedetect@${instance}`)),
          measurements.map(line => `[volumedetect@${instance}] ${line}`));
      }
      assert.equal(lines.length, frames === 0 ? 4 : repetitions === 125 ? 10 : 8);
    });
  }
}
