import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseWav, serializeWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

function chunk(bytes: Buffer, id: string): Buffer {
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    if (bytes.toString("ascii", offset, offset + 4) === id) return bytes.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + size % 2;
  }
  throw new Error(`Missing ${id} chunk`);
}

// FFmpeg 7.0.2 fixtures: MP3 has eight 216-byte frames at 48 kbit/s
// and a zero nAvgBytesPerSec; the MP2 control declares 48000 bytes/s.
for (const [codec, expected] of [["mp3", 6000], ["mp2", 48000]] as const) {
  for (const sync of [false, true]) {
    it(`writes the ${codec} WAV byte rate on stream copy (${sync ? "sync" : "async"})`, async () => {
      const input = readFileSync(new URL(`./fixtures/byte-rate-${codec}.wav`, import.meta.url));
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.wav", input);
      const args = ["-v", "error", "-y", "-i", "/in.wav", "-c:a", "copy", "/out.wav"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
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
      assert.equal(chunk(output, "fmt ").readUInt32LE(8), expected);
      assert.equal(chunk(output, "fmt ").readUInt16LE(0), codec === "mp3" ? 0x55 : 0x50);
      assert.deepEqual(chunk(output, "data"), chunk(input, "data"));
    });
  }
}

it("fills the missing MP3 byte rate without mutating the source document", () => {
  const input = readFileSync(new URL("./fixtures/byte-rate-mp3.wav", import.meta.url));
  const doc = parseWav(input, { decodeAudio: false });
  const output = Buffer.from(serializeWav(doc, { audioCodec: "copy" }));
  assert.equal(chunk(output, "fmt ").readUInt32LE(8), 6000);
  assert.equal(chunk(input, "fmt ").readUInt32LE(8), 0);
  assert.equal(new DataView(doc.tracks[0]!.codecDescriptions[0]!.rawWavFormatBytes!.buffer,
    doc.tracks[0]!.codecDescriptions[0]!.rawWavFormatBytes!.byteOffset).getUint32(8, true), 0);
});
