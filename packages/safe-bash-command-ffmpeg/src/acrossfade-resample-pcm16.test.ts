import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const overlap of [true, false]) {
  it(`acrossfade materializes resampled PCM16 before fading (overlap=${overlap})`, async () => {
    const fs = Volume.fromJSON({});
    for (const [input, length] of [145, 200].entries()) {
      const bytes = Buffer.alloc(length * 2);
      for (let i = 0; i < length; i++) bytes.writeInt16LE((i * (119 + 37 * input)) % 17000 - 7000, i * 2);
      fs.writeFileSync(`/${input}.raw`, bytes);
    }
    const outputs: Buffer[] = [];
    for (const explicit of [false, true]) {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-f", "s16le", "-ar", "44100", "-ac", "1", "-i", "/0.raw",
          "-f", "s16le", "-ar", "48000", "-ac", "1", "-i", "/1.raw", "-filter_complex",
          `${explicit ? "[1:a]aresample=44100:osf=s16[b];[0:a][b]" : "[0:a][1:a]"}acrossfade=ns=20:o=${Number(overlap)}`,
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
      outputs.push(fs.readFileSync("/out.raw") as Buffer);
    }
    // FFmpeg 7.0.2: the untouched tail rounds this half sample to even.
    assert.equal(outputs[0]!.length / 2, overlap ? 309 : 329);
    assert.equal(outputs[0]!.readInt16LE((overlap ? 218 : 238) * 2), 8776);
    assert.deepEqual(outputs[0], outputs[1]);
  });
}
