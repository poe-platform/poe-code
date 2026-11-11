import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

async function run(options: string): Promise<Buffer> {
  const volume = Volume.fromJSON({});
  for (const [name, value] of [["a", 12000], ["b", -3000]] as const) {
    volume.writeFileSync(`/${name}.wav`, encodeWav({ sampleRate: 44100,
      channels: [new Float64Array(8000).fill(value / 32768)] }));
  }
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-i", "/a.wav", "-i", "/b.wav", "-filter_complex",
      `[0:a][1:a]acrossfade=${options}[o]`, "-map", "[o]", "-f", "s16le", "/out.pcm"],
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
  return volume.readFileSync("/out.pcm") as Buffer;
}

// FFmpeg 7.0.2 rounds 175000 us at 44100 Hz to 7718 samples, including
// when overlap is disabled and only the transition position changes.
for (const overlap of [0, 1]) {
  for (const [duration, fade] of [["0.174999", 7717], ["0.175", 7718], ["0.175001", 7718]] as const) {
    for (const key of ["d", "duration"]) {
      it(`acrossfade ${key}=${duration}:o=${overlap} rounds before positioning the transition`, async () => {
        const output = await run(`${key}=${duration}:o=${overlap}`);
        const control = await run(`ns=${fade}:o=${overlap}`);
        assert.equal(output.length, (16000 - overlap * fade) * 2);
        assert.equal(output.readInt16LE((8000 - fade - 1) * 2), 12000);
        assert.equal(output.readInt16LE((8000 - fade) * 2), 11998);
        assert.deepEqual(output, control);
      });
    }
  }
}
