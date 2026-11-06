import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const cases = [
  ["with\\ space.wav", "with space.wav"],
  ["'with space.wav'", "with space.wav"],
  ['"a.wav"', '"a.wav"'],
  ["a.wav ignored", "a.wav"],
  ["a.wav\tignored", "a.wav"],
  ["'with space'.wav ignored", "with space.wav"],
  ["'with'\\ space.wav", "with space.wav"],
  ["'single'\\''.wav", "single'.wav"],
  ["'back\\slash.wav'", "back\\slash.wav"],
  ["'a.wav", "a.wav"],
  ["a.wav\\ ", "a.wav "],
  ["'a.wav '", "a.wav "],
  ["a.wav\\", "a.wav\\"]
] as const;

for (const [token, filename] of cases) {
  for (const separator of [" ", "\t"]) {
    it(`concat reads native filename ${JSON.stringify(token)} after ${JSON.stringify(separator)}`, async () => {
      const volume = Volume.fromJSON({ "/list.ffconcat": `file${separator}${token}\nfile b.wav\n` });
      // A distinct decoy detects accidentally stripping literal double quotes.
      for (const [name, base] of [["a.wav", 12000], [filename, 1000], ["b.wav", -9000]] as const) {
        volume.writeFileSync(`/${name}`, encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 8000 }, (_, i) => (base + i) / 32768)] }));
      }
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", "/list.ffconcat", "-c:a", "pcm_s16le", "/out.wav"],
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
      const samples = parseWav(volume.readFileSync("/out.wav") as Buffer).tracks[0]!.decodedAudio!.channelData[0]!;
      assert.equal(samples.length, 16000);
      assert.deepEqual(Array.from(samples, sample => sample * 32768), [
        ...Array.from({ length: 8000 }, (_, i) => 1000 + i),
        ...Array.from({ length: 8000 }, (_, i) => -9000 + i)
      ]);
    });
  }
}

it("concat fails when only the unquoted name exists for a double-quoted token", async () => {
  const wav = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000)] });
  const volume = Volume.fromJSON({ "/list.ffconcat": 'file "a.wav"\n' });
  volume.writeFileSync("/a.wav", wav);
  volume.writeFileSync("/out.wav", wav);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", "/list.ffconcat", "-c:a", "pcm_s16le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.notEqual(result.exitCode, 0);
  assert.ok(stderr.includes('"a.wav"'), stderr);
  assert.deepEqual(volume.readFileSync("/out.wav"), Buffer.from(wav));
});
