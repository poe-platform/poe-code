import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseWav } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2: mono 16 kHz IMA ADPCM, seven 1024-byte blocks.
const input = readFileSync(new URL("../../mp4-ast/src/fixtures/avi-ima.wav", import.meta.url));
const source = parseWav(input, { decodeAudio: false }).tracks[0]!;

for (const sync of [false, true]) for (const video of [false, true]) {
  it(`copies IMA WAV to ${video ? "audio/video" : "audio-only"} AVI (${sync ? "sync" : "async"})`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.wav", input);
    volume.writeFileSync("/in.mp4", createSyntheticMp4({ width: 48, height: 32, frameCount: 8, includeAudio: false }));
    const args = ["-i", "/in.wav", ...(video ? ["-i", "/in.mp4"] : []),
      ...(sync ? [] : [...(video ? ["-map", "1:v"] : []), "-map", "0:a"]),
      "-c", "copy", "/out.avi"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
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
    const output = volume.readFileSync("/out.avi") as Buffer;
    assert.equal(output.readUInt32LE(output.indexOf("avih") + 32), video ? 2 : 1);
    const audioHeader = output.indexOf("auds");
    const format = output.indexOf("strf", audioHeader);
    assert.equal(output.readUInt16LE(format + 8), 0x11);
    assert.deepEqual(output.subarray(format + 8, format + 8 + output.readUInt32LE(format + 4)),
      Buffer.from(source.codecDescriptions[0]!.rawWavFormatBytes!));
    // Native WAV-copy AVI clock: block alignment / average bytes per second.
    assert.equal(output.readUInt32LE(audioHeader + 20), 8);
    assert.equal(output.readUInt32LE(audioHeader + 24), 125);
    assert.equal(output.readUInt32LE(audioHeader + 32), 7);
    assert.equal(output.readUInt32LE(audioHeader + 44), 1024);
    const movi = output.indexOf("movi");
    const index = output.indexOf("idx1", movi);
    const payloads: Buffer[] = [];
    for (let pos = index + 8; pos < index + 8 + output.readUInt32LE(index + 4); pos += 16) {
      if (output.toString("ascii", pos, pos + 4) !== (video && !sync ? "01wb" : "00wb")) continue;
      const chunk = movi + output.readUInt32LE(pos + 8);
      const size = output.readUInt32LE(pos + 12);
      assert.equal(output.readUInt32LE(chunk + 4), size);
      payloads.push(output.subarray(chunk + 8, chunk + 8 + size));
    }
    assert.equal(payloads.length, 7);
    assert.deepEqual(payloads, source.samples.map(sample => Buffer.from(sample.data)));
  });
}
