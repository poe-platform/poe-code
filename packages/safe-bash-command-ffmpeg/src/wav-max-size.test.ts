import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const maxSize of [undefined, 0, 1024, 2049]) {
  for (const selected of [0, 1]) {
    it(`WAV max_size=${maxSize} applies only to input 0, selecting ${selected}`, async () => {
      const fs = Volume.fromJSON({});
      fs.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
        channels: [Float64Array.from({ length: 2048 }, (_, i) => i / 32768)] }));
      let stdout = "", stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", ...(maxSize === undefined ? [] : ["-max_size", String(maxSize)]),
          "-i", "/in.wav", "-i", "/in.wav", "-map", `${selected}:a`, "-c:a", "copy", "-f", "framecrc", "-"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: { async readFile(path: string) { return fs.readFileSync(path); }, async stat(path: string) { return fs.statSync(path); } },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const rows = stdout.split("\n").filter(line => line && !line.startsWith("#")).map(row => row.split(",").map(field => field.trim()));
      const large = maxSize === 2049 && selected === 0;
      const frames = large ? 1024 : 512;
      assert.deepEqual(rows.map(row => row.slice(0, 5)), Array.from({ length: 2048 / frames }, (_, i) =>
        ["0", String(i * frames), String(i * frames), String(frames), String(frames * 2)]));
      if (large) assert.deepEqual(rows.map(row => row[5]), ["0xc273041e", "0xc633141e"]);
    });
  }
}

it("sync WAV copy accepts max_size and preserves PCM", () => {
  const fs = Volume.fromJSON({});
  const wav = encodeWav({ sampleRate: 8000, channels: [Float64Array.from({ length: 2048 }, (_, i) => i / 32768)] });
  fs.writeFileSync("/in.wav", wav);
  assert.equal(evalSyncFfmpeg(["-max_size", "2049", "-i", "/in.wav", "-c:a", "copy", "-f", "s16le", "/out.raw"], undefined,
    path => fs.existsSync(path) ? fs.readFileSync(path) as Buffer : undefined,
    (path, bytes) => { fs.writeFileSync(path, bytes); return true; }), "");
  const output = fs.readFileSync("/out.raw") as Buffer;
  assert.equal(output.length, 4096);
  assert.deepEqual(Array.from({ length: 2048 }, (_, i) => output.readInt16LE(i * 2)), Array.from({ length: 2048 }, (_, i) => i));
});

for (const value of ["-1", "1.5", "2147483648", "invalid"]) {
  it(`sync WAV rejects invalid max_size ${value} before writing`, () => {
    const result = evalSyncFfmpeg(["-max_size", value, "-i", "/in.wav", "-c:a", "copy", "/out.wav"], undefined,
      () => { assert.fail("must validate before reading"); },
      () => { assert.fail("must not write output"); });
    assert.equal(result, undefined);
  });
}
