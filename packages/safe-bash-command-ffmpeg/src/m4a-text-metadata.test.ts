import assert from "node:assert/strict";
import { it } from "node:test";
import { readFileSync } from "node:fs";
import { Volume } from "memfs";
import { parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const fixture = readFileSync(new URL("../../mp4-ast/src/fixtures/compilation.m4a", import.meta.url));
const document = parseMp4(fixture);
const original = { title: "One", artist: "Solo", albumArtist: "Band", copyright: "Studio", description: "Session", trackNumber: "3/12", discNumber: "1/2" };
const native = Buffer.from(serializeMp4({ ...document, metadata: original }));
for (const sync of [false, true]) {
  for (const [options, expected] of [
    [[], original],
    [["-metadata", "album_artist=New", "-metadata", "copyright=NewStudio", "-metadata", "description=NewSession"], { ...original, albumArtist: "New", copyright: "NewStudio", description: "NewSession" }],
    [["-metadata", "album_artist=", "-metadata", "copyright=", "-metadata", "description="], { title: "One", artist: "Solo", trackNumber: "3/12", discNumber: "1/2" }]
  ] as const) {
    it(`applies M4A text metadata ${JSON.stringify(options)} (${sync ? "sync" : "async"})`, async () => {
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
      assert.deepEqual(parseMp4(bytes).metadata, { custom: {}, ...expected });
      assert.deepEqual(parseMp4(bytes).tracks[0]!.samples.map(sample => sample.data),
        parseMp4(native).tracks[0]!.samples.map(sample => sample.data));
    });
  }
}
