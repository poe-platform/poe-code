import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { Volume } from "memfs";
import { parseMp4, probeMp4, probeMp4MetadataSource } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native fixture: ffmpeg -f lavfi -i sine=frequency=440:sample_rate=16000:duration=0.05
// -c:a aac -metadata composer=Writer -metadata album_artist=Band -metadata title=One -metadata artist=Solo composer.m4a
const native = readFileSync(new URL("../../mp4-ast/src/fixtures/composer.m4a", import.meta.url));
for (const sync of [false, true]) {
  for (const [options, expected] of [
    [[], "Writer"], [["-metadata", "composer=NewWriter"], "NewWriter"],
    [["-map_metadata", "-1", "-metadata", "composer=NewWriter"], "NewWriter"],
    [["-map_metadata", "-1"], undefined], [["-metadata", "composer="], undefined]
  ] as const) {
    it(`copies M4A composer metadata ${JSON.stringify(options)} (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({ "/in.m4a": native });
      const args = ["-y", "-v", "error", "-i", "/in.m4a", "-c", "copy", ...options, "/out.m4a"];
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
      const bytes = volume.readFileSync("/out.m4a") as Buffer;
      assert.equal(probeMp4(bytes).format.tags?.composer, expected);
      const source = await probeMp4MetadataSource({ size: bytes.length,
        async read(offset, length) { return bytes.subarray(offset, offset + length); }
      }, 0);
      let composer = source.tags.composer;
      if (typeof composer === "object") {
        let text = "";
        for await (const chunk of composer.chunks()) text += chunk;
        composer = text;
      }
      assert.equal(composer, expected);
      assert.equal(parseMp4(bytes).metadata.albumArtist, options.some(option => option === "-map_metadata") ? undefined : "Band");
      assert.deepEqual(parseMp4(bytes).tracks[0]!.samples.map(sample => sample.data),
        parseMp4(native).tracks[0]!.samples.map(sample => sample.data));
    });
  }
}
