import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 consumes the frame that discovers the output time limit,
// including samples that are not written to the output.
for (const graph of [false, true]) {
  for (const [limit, bytes, measured, mean, peak] of [
    [["-t", "0.001"], 32, 24, "-9.9", "-4.3"],
    [["-to", "0.001"], 32, 24, "-9.9", "-4.3"],
    [["-t", "0.00075"], 24, 24, "-9.9", "-4.3"],
    [["-to", "0.00075"], 24, 24, "-9.9", "-4.3"],
    [["-frames:a", "1"], 16, 8, "-6.6", "-4.3"],
    [["-t", "0.001", "-frames:a", "1"], 16, 8, "-6.6", "-4.3"],
    [[], 96, 48, "-7.6", "-1.6"]
  ] as const) {
    it(`volumedetect measures consumed audio (${limit.join(" ") || "unbounded"}, graph=${graph})`, async () => {
      const input = Buffer.alloc(96);
      for (let i = 0; i < 48; i++) input.writeInt16LE((i * 1433) % 48000 - 20000, i * 2);
      const fs = Volume.fromJSON({ "/in.raw": input });
      const filter = "asetnsamples=n=4:p=0,volumedetect";
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          ...limit, "-f", "s16le", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { fs.writeFileSync(path, data); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(data: Uint8Array) { stdout.push(data.slice()); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.deepEqual(Buffer.concat(stdout), input.subarray(0, bytes));
      assert.equal(stderr, `n_samples: 0\nn_samples: ${measured}\nmean_volume: ${mean} dB\nmax_volume: ${peak} dB\n`);
    });
  }
}
