import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// FFmpeg 7.0.2 consumes complete upstream frames to fill aloop's first chunk.
for (const complex of [false, true]) {
  for (const [loop, outputSamples, measured, mean] of [
    ["aloop=loop=1:size=2", 2, 2, "-9.0"],
    ["aloop=loop=1:size=4", 4, 4, "-10.9"],
    ["aloop=loop=1:size=6", 6, 6, "-12.6"],
    ["aloop@cache=1:3", 3, 4, "-10.9"],
    ["aloop=loop=0:size=4", 4, 4, "-10.9"],
    ["aloop=loop=1:size=16", 8, 8, "-13.8"],
    ["aloop=loop=1:size=0", 2, 2, "-9.0"]
  ] as const) {
    for (const frames of [undefined, 0, 1]) {
      it(`measures upstream aloop demand: ${loop} (complex=${complex}, frames=${frames})`, async () => {
        const input = Buffer.from("00400000002000100008000400020001", "hex");
        const fs = Volume.fromJSON({ "/in.raw": input });
        const chain = `asetnsamples=n=2:p=0,volumedetect,anull,${loop}`;
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
            ...(complex ? ["-filter_complex", `[0:a]${chain}[out]`, "-map", "[out]"] : ["-af", chain]),
            ...(frames === undefined ? [] : ["-frames:a", String(frames)]), "-f", "s16le", "/out.raw"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: { async readFile(path: string) { return fs.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
            async stat(path: string) { return fs.statSync(path); } },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        if (frames !== undefined) assert.deepEqual(fs.readFileSync("/out.raw"), input.subarray(0, frames * outputSamples * 2));
        assert.ok(stderr.endsWith(frames === 0 ? "n_samples: 0\nn_samples: 0\n"
          : `n_samples: 0\nn_samples: ${frames === 1 ? measured : 8}\nmean_volume: ${frames === 1 ? mean : "-13.8"} dB\nmax_volume: -6.0 dB\n`), stderr);
        assert.deepEqual(fs.readFileSync("/in.raw"), input);
      });
    }
  }
}
