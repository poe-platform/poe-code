import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16: identity filters must not force echo to round early.
for (const [suffix, expected] of [
  ["", [50, 101, 152, 203, 305, 407, 509, 611, 254, 305, 356, 407]],
  [",volume=2", [101, 203, 305, 407, 610, 814, 1018, 1222, 509, 611, 713, 815]],
  [",anull,volume=2", [101, 203, 305, 407, 610, 814, 1018, 1222, 509, 611, 713, 815]],
  [",aformat=fltp,volume=2", [101, 203, 305, 407, 610, 814, 1018, 1222, 509, 611, 713, 815]],
  [",anull@identity,acopy,volume@gain=2:precision=double", [101, 203, 305, 407, 610, 814, 1018, 1222, 509, 611, 713, 815]],
  [",aformat,volume=2", [101, 203, 305, 407, 610, 814, 1018, 1222, 509, 611, 713, 815]],
  [",aformat=sample_rates=8000,anull,volume=2", [101, 203, 305, 407, 610, 814, 1018, 1222, 509, 611, 713, 815]],
  [",aformat=f=fltp,volume=2", [101, 203, 305, 407, 610, 814, 1018, 1222, 509, 611, 713, 815]],
  [",aformat=fltp|s16p,volume=2", [101, 203, 305, 407, 610, 814, 1018, 1222, 509, 611, 713, 815]],
  [",aformat=s16p,volume=2", [100, 202, 304, 406, 610, 814, 1018, 1222, 508, 610, 712, 814]],
  [",aformat=s16,volume=2", [100, 202, 304, 406, 610, 814, 1018, 1222, 508, 610, 712, 814]],
  [",aformat=flt,volume=2", [100, 202, 304, 406, 610, 814, 1018, 1222, 508, 610, 712, 814]],
  [",anull,volume=2:precision=fixed", [100, 202, 304, 406, 610, 814, 1018, 1222, 508, 610, 712, 814]],
  [",aformat=fltp", [50, 102, 152, 204, 305, 407, 509, 611, 254, 306, 356, 408]],
  [",aformat=dblp,anull,volume=2", [101, 203, 305, 407, 610, 814, 1018, 1222, 509, 611, 713, 815]],
  [",aformat=fltp,anull,aformat=s16p,volume=2", [100, 204, 304, 408, 610, 814, 1018, 1222, 508, 612, 712, 816]]
] as const) {
  for (const graph of [false, true]) {
    it(`echo${suffix} preserves native precision (${graph ? "graph" : "simple"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000, channels: [
        Float64Array.from([101, 203, 305, 407, 509, 611, 713, 815], sample => sample / 32768)
      ] }));
      let stderr = "";
      const filter = `aecho=0.5:1:0.5:0.5${suffix}`;
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", "/in.wav", ...(graph
          ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
          "-f", "s16le", "/out.pcm"],
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
      const pcm = volume.readFileSync("/out.pcm") as Buffer;
      assert.equal(pcm.length, expected.length * 2);
      assert.deepEqual(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2)), expected);
    });
  }
}
