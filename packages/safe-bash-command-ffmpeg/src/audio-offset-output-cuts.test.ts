import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2 PCM output, indexed into the original (or reversed) samples.
const cases = [
  { offset: "0.001", output: ["-to", "0.0005"], indices: [] },
  { offset: "0.001", output: ["-t", "0.0005"], indices: [] },
  { offset: "0.001", output: ["-ss", "0.000125"], indices: [0, 1, 2, 3, 4, 5, 6, 7] },
  { offset: "0.001", output: ["-ss", "0.00125", "-t", "0.0005"], indices: [2, 3, 4, 5] },
  { offset: "0.001", output: ["-to", "0.0015"], indices: [0, 1, 2, 3, 4, 5, 6, 7] },
  { offset: "0.001", output: [], indices: [0, 1, 2, 3, 4, 5, 6, 7] },
  { offset: undefined, output: ["-to", "0.0005"], indices: [0, 1, 2, 3] },
  { offset: undefined, output: ["-t", "0.0005"], indices: [0, 1, 2, 3] },
  { offset: undefined, output: ["-ss", "0.000125"], indices: [1, 2, 3, 4, 5, 6, 7] },
  { offset: "-0.00025", output: ["-t", "0.0005"], indices: [0, 1, 2, 3] },
  { offset: "-0.00025", output: ["-ss", "0.000125"], indices: [3, 4, 5, 6, 7] }
];
for (const filter of [undefined, "anull", "areverse"]) {
  for (const graph of filter ? [false, true] : [false]) {
    for (const { offset, output, indices } of cases) {
      it(`cuts ${filter ?? "unfiltered"} PCM at its input offset ${offset ?? "default"}: ${output.join(" ")} (graph=${graph})`, async () => {
        const input = Buffer.alloc(16);
        for (let i = 0; i < 8; i++) input.writeInt16LE(i + 1, i * 2);
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.raw", input);
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1",
            ...(offset === undefined ? [] : ["-itsoffset", offset]), "-i", "/in.raw",
            ...(filter === undefined ? [] : graph
              ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]),
            ...output, "-f", "s16le", "/out.raw"],
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
        const bytes = volume.readFileSync("/out.raw") as Buffer;
        assert.deepEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2)),
          indices.map(i => filter === "areverse" ? 8 - i : i + 1));
      });
    }
  }
}

for (const output of [["-to", "0.0005"], ["-t", "0.0005"], ["-ss", "0.000125"]]) {
  it(`defers PCM ${output.join(" ")} to the async timestamp-aware path without writing output`, () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8], value => value / 32768)] }));
    const result = evalSyncFfmpeg(["-y", "-itsoffset", "0.001", "-i", "/in.wav", ...output, "/out.wav"], undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
    assert.equal(result, undefined);
    assert.equal(volume.existsSync("/out.wav"), false);
  });
}
