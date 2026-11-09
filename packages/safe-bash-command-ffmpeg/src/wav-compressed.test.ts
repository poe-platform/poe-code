import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { parseWav, serializeWav } from "@poe-code/mp4-ast";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 9.0.2: encode the nine PCM16 samples
// [-32768,-16385,-257,-1,0,1,257,16385,32767] at 8000 Hz to MP3/AAC WAV,
// then decode each WAV to raw s16le. No native executable is needed by the test.
for (const codec of ["mp3", "aac"]) {
for (const sync of [false, true]) {
  it(`decodes ${codec} in WAV to native PCM16 (${sync ? "sync" : "async"})`, async () => {
    const input = readFileSync(new URL(`./fixtures/wav-${codec}.wav`, import.meta.url));
    const expected = readFileSync(new URL(`./fixtures/wav-${codec}.pcm`, import.meta.url));
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    const args = ["-v", "error", "-y", "-i", "/in.wav", "-c:a", "pcm_s16le", "/out.wav"];
    if (sync) {
      const result = evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
      assert.equal(result, "");
    } else {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
    }
    const output = volume.readFileSync("/out.wav") as Buffer;
    const dataOffset = output.indexOf("data") + 8;
    const actual = output.subarray(dataOffset, dataOffset + output.readUInt32LE(dataOffset - 4));
    assert.equal(actual.length, expected.length);
    for (let i = 0; i < actual.length; i += 2) {
      assert.ok(Math.abs(actual.readInt16LE(i) - expected.readInt16LE(i)) <= 1, `sample ${i / 2}`);
    }
  });
}
}

for (const codec of ["mp3", "aac"]) {
  it(`preserves ${codec} WAV metadata and compressed payload when copying`, () => {
    const input = readFileSync(new URL(`./fixtures/wav-${codec}.wav`, import.meta.url));
    const doc = parseWav(input, { decodeAudio: false });
    assert.equal(doc.tracks[0]!.codecDescriptions[0]!.codecName, codec);
    assert.equal(doc.tracks[0]!.decodedAudio, undefined);
    const output = Buffer.from(serializeWav(doc, { audioCodec: "copy" }));
    for (const chunk of ["fmt ", "fact", "data"]) {
      const start = input.indexOf(chunk) + 8;
      const end = start + input.readUInt32LE(start - 4);
      const actual = output.indexOf(chunk) + 8;
      assert.equal(output.readUInt32LE(actual - 4), end - start);
      const expected = Buffer.from(input.subarray(start, end));
      if (codec === "mp3" && chunk === "fmt ") expected.writeUInt32LE(1000, 8);
      assert.deepEqual(output.subarray(actual, actual + end - start), expected);
    }
  });
}

it("rejects truncated AAC configuration instead of interpreting its payload as PCM", () => {
  const input = readFileSync(new URL("./fixtures/wav-aac.wav", import.meta.url));
  const format = input.indexOf("fmt ") + 8;
  input.writeUInt16LE(input.readUInt32LE(format - 4), format + 16);
  assert.throws(() => parseWav(input), /Truncated WAV AAC configuration/);
});
