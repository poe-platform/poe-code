import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const threads of [undefined, "1", "2"]) {
  const option = threads === undefined ? [] : ["-filter_threads", threads];
  for (const position of ["before input", "before output"]) {
    it(`accepts global filter_threads=${threads ?? "omitted"} ${position} with exact trimmed PCM`, async () => {
      const input = Buffer.alloc(32);
      for (let i = 0; i < 16; i++) input.writeInt16LE(i + 1, i * 2);
      const volume = Volume.fromJSON({});
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-hide_banner", "-loglevel", "error",
          ...(position === "before input" ? option : []),
          "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "pipe:0",
          ...(position === "before output" ? option : []),
          "-af", "atrim=start_sample=3:end_sample=7", "-f", "s16le", "pipe:1"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { yield input; })(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.deepEqual(Buffer.concat(stdout), Buffer.from([4, 0, 5, 0, 6, 0, 7, 0]));
      assert.deepEqual(volume.readdirSync("/"), []);
    });
  }

  it(`accepts global filter_threads=${threads ?? "omitted"} in synchronous execution`, () => {
    const samples = Float64Array.from({ length: 16 }, (_, i) => (i + 1) / 32768);
    const input = encodeWav({ sampleRate: 8000, channels: [samples] });
    const volume = Volume.fromJSON({ "/in.wav": Buffer.from(input) });
    assert.equal(evalSyncFfmpeg(["-v", "error", ...option, "-i", "/in.wav", "/out.wav"], undefined,
      path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
    const audio = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!;
    assert.deepEqual(Array.from(audio.channelData[0]!), Array.from(samples));
    assert.deepEqual(volume.readFileSync("/in.wav"), Buffer.from(input));
  });
}
