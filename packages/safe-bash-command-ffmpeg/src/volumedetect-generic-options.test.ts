import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const valid = [
  "volumedetect", "volumedetect@meter=",
  "volumedetect=threads=1", "volumedetect=thread_type=slice", "volumedetect=extra_hw_frames=4",
  "volumedetect@meter=threads=1:thread_type=slice:extra_hw_frames=4",
  "volumedetect=threads=default:thread_type=none:extra_hw_frames=min",
  "volumedetect=threads=1+1:thread_type=+slice-slice:extra_hw_frames=-1:",
  "volumedetect=threads=2147483647:thread_type=4294967295:extra_hw_frames=2147483647"
];
const invalid = [
  "volumedetect=1", "volumedetect=unknown=1", "volumedetect=enable=1",
  "volumedetect=threads=-1", "volumedetect=threads=2147483648", "volumedetect=threads=",
  "volumedetect=threads=NaN", "volumedetect=threads=1=2", "volumedetect=threads=1::extra_hw_frames=4",
  "volumedetect=thread_type=other", "volumedetect=thread_type=1.5", "volumedetect=thread_type=4294967296",
  "volumedetect=thread_type=slice+", "volumedetect=extra_hw_frames=-2", "volumedetect=extra_hw_frames=2147483648"
];

for (const graph of [false, true]) {
  for (const filter of [...valid, ...invalid]) {
    it(`volumedetect options ${filter}, graph=${graph}`, async () => {
      const input = Buffer.from("00400000002000100008000400020001", "hex");
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.raw", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.raw"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return fs.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { fs.writeFileSync(path, bytes); },
          async stat(path: string) { return fs.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (valid.includes(filter)) {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(fs.readFileSync("/out.raw"), input);
        assert.equal(stderr.replaceAll("[volumedetect@meter] ", "").endsWith(
          "n_samples: 8\nmean_volume: -13.8 dB\nmax_volume: -6.0 dB\n"), true, stderr);
      } else {
        assert.notEqual(result.exitCode, 0, filter);
        assert.equal(fs.existsSync("/out.raw"), false);
      }
    });
  }
}
