import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2: integer fades truncate; explicit float fades round on output.
for (const [filter, length, faded] of [
  ["aresample=4000,afade=ns=7", 80, true],
  ["aresample=4000:osf=s16,afade=ns=7", 80, true],
  ["aresample=4000,aformat=sample_fmts=s16,afade=ns=7", 80, true],
  ["aresample=4000:osf=flt,afade=ns=7", 80, true],
  ["aresample=8000,afade=ns=7", 160, true],
  ["afade=ns=7", 160, true],
  ["aresample=4000", 80, false]
] as const) {
  for (const graph of [false, true]) it(`${filter} preserves PCM16 rounding (graph=${graph})`, async () => {
    const fs = Volume.fromJSON({});
    fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
      channels: [new Float64Array(160).fill(12000 / 32768)] }));
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.wav",
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
    assert.equal(result.exitCode, 0, stderr);
    const output = fs.readFileSync("/out.raw") as Buffer;
    const expected = Array<number>(length).fill(12000);
    if (faded) expected.splice(0, 7, ...(filter.includes("osf=flt")
      ? [0, 1714, 3429, 5143, 6857, 8571, 10286]
      : [0, 1714, 3428, 5142, 6857, 8571, 10285]));
    assert.equal(output.length, length * 2);
    assert.deepEqual(Array.from({ length }, (_, i) => output.readInt16LE(i * 2)), expected);
  });
}
