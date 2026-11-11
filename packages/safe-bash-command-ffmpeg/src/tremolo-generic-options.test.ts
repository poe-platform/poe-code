import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: 16 mono PCM16 samples of 16384 at 8 kHz.
for (const [options, status] of [
  ["f=1000:d=1", 0],
  ["f=1000:d=1:threads=1", 0],
  ["f=1000:d=1:thread_type=slice", 0],
  ["f=1000:d=1:extra_hw_frames=1", 0],
  ["f=1000:d=1:threads=1:thread_type=slice:extra_hw_frames=1", 0],
  ["f=1000:d=1:threads=0:thread_type=none:extra_hw_frames=-1", 0],
  ["f=1000:d=1:threads=max:thread_type=all:extra_hw_frames=max", 0],
  ["f=1000:d=1:threads=default+1:thread_type=+slice-slice:extra_hw_frames=min+1", 0],
  ["f=1000:d=1:threads=1.5:extra_hw_frames=0.5", 0],
  ["f=1000:d=1:thread_type=4294967295", 0],
  ["1000:1:threads=1", 0],
  ["threads=1:f=1000:d=1", 0],
  ["1:threads=1:1000:d=1", 0],
  ["f=1000:d=1:threads=1:enable=0", 0],
  ["f=1000:d=1:threads=-1", 222],
  ["f=1000:d=1:threads=2147483648", 222],
  ["f=1000:d=1:threads=foo", 234],
  ["f=1000:d=1:threads=", 234],
  ["f=1000:d=1:threads=0/0", 234],
  ["f=1000:d=1:thread_type=bogus", 234],
  ["f=1000:d=1:thread_type=0.5", 222],
  ["f=1000:d=1:thread_type=4294967296", 222],
  ["f=1000:d=1:extra_hw_frames=-2", 222],
  ["f=1000:d=1:extra_hw_frames=2147483648", 222],
  ["f=1000:d=1:extra_hw_frames=foo", 234],
  ["f=1000:d=1:threads=-1:threads=1", 222],
  ["f=1000:d=1:unknown=1", 8]
] as const) {
  for (const graph of [false, true]) {
    it(`tremolo=${options} matches native status and PCM (${graph ? "graph" : "simple"})`, async () => {
      const input = Buffer.from("0040".repeat(16), "hex");
      const volume = Volume.fromJSON({ "/in.raw": input });
      const filter = `tremolo=${options}`;
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(graph ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, status, stderr);
      assert.equal(Buffer.concat(stdout).toString("hex"), status !== 0 ? ""
        : options.endsWith("enable=0") ? input.toString("hex")
          : "0040a13600205f0900005f090020a1360040a13600205f0900005f090020a136");
      assert.deepEqual(volume.readFileSync("/in.raw"), input);
    });
  }
}
