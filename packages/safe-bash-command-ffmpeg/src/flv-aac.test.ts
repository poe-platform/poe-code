import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseFlv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const fixture = readFileSync(new URL("../../mp4-ast/src/fixtures/aac-lc.flv", import.meta.url));

// Native fixture: ffmpeg -f lavfi -i sine=f=880:r=44100:d=2 -c:a aac -profile:a aac_low aac-lc.flv
for (const objectType of [1, 2]) {
  for (const sync of [false, true]) {
    it(`${sync ? "sync" : "async"} FLV AAC object type ${objectType} stream copy preserves decoder configuration and packets`, async () => {
      const input = new Uint8Array(fixture);
      // LC packets are also valid Main packets. Change only the declared object type;
      // preserve the full native AudioSpecificConfig, including its extension bytes.
      let offset = 13;
      while (input[offset] !== 8) {
        const size = (input[offset + 1]! << 16) | (input[offset + 2]! << 8) | input[offset + 3]!;
        offset += 15 + size;
      }
      assert.equal(input[offset + 12], 0, "AAC sequence header");
      input[offset + 13] = (input[offset + 13]! & 7) | (objectType << 3);
      const size = (input[offset + 1]! << 16) | (input[offset + 2]! << 8) | input[offset + 3]!;
      const config = input.slice(offset + 13, offset + 11 + size);
      const volume = Volume.fromJSON({ "/in.flv": Buffer.from(input) });
      const args = ["-y", "-v", "error", "-i", "/in.flv", ...(sync ? [] : ["-map", "0:a"]), "-c", "copy", "/out.flv"];
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
      const copied = parseFlv(new Uint8Array(volume.readFileSync("/out.flv") as Buffer));
      const source = parseFlv(input);
      assert.equal(copied.tracks.length, 1);
      assert.equal(copied.tracks[0]!.codecDescriptions[0]!.esds?.audioObjectType, objectType);
      assert.deepEqual(copied.tracks[0]!.codecDescriptions[0]!.esds?.decoderSpecificInfo, config);
      for (const track of source.tracks) {
        const output = copied.tracks.find(candidate => candidate.type === track.type)!;
        assert.deepEqual(output.samples.map(sample => sample.data), track.samples.map(sample => sample.data));
        assert.deepEqual(output.samples.map(sample => sample.dts), track.samples.map(sample => sample.dts));
      }
    });
  }
}
