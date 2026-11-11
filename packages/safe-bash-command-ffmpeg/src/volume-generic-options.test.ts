import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const valid = [
  "volume=.501", "volume=.501:threads=2", "volume=.501:thread_type=slice",
  "volume=.501:extra_hw_frames=0",
  "volume@gain=.501:threads=2:thread_type=slice:extra_hw_frames=0",
  "volume=.501:threads=default:thread_type=none:extra_hw_frames=min",
  "volume=.501:threads=1+1:thread_type=+slice-slice:extra_hw_frames=-1:",
  "volume=.501:threads=2147483647:thread_type=4294967295:extra_hw_frames=2147483647"
];
const invalid = [
  "unknown=1", "threads=-1", "threads=2147483648", "threads=",
  "threads=NaN", "threads=1=2", "threads=1::extra_hw_frames=4",
  "thread_type=other", "thread_type=1.5", "thread_type=4294967296",
  "thread_type=slice+", "extra_hw_frames=-2", "extra_hw_frames=2147483648"
].map(option => `volume=.501:${option}`);

for (const graph of [false, true]) {
  for (const filter of [...valid, ...invalid]) {
    it(`volume options ${filter}, graph=${graph}`, async () => {
      // Native FFmpeg 7.0.2 PCM16 input and expected output for gain .501.
      const input = Buffer.from("d08affbffdffffff0100030001403075", "hex");
      const fs = Volume.fromJSON({ "/out.raw": "KEEP" });
      fs.writeFileSync("/in.raw", input);
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
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
        assert.equal(fs.readFileSync("/out.raw").toString("hex"), "4ac5efdffeffffff010002001120b63a");
        assert.equal(stderr, "");
      } else {
        assert.notEqual(result.exitCode, 0, filter);
        assert.equal(fs.readFileSync("/out.raw", "utf8"), "KEEP");
      }
    });
  }
}
