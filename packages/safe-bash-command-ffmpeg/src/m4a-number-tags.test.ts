import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const [options, track, disc] of [
    [[], "3/12", "1/2"],
    [["-metadata", "track=9/13", "-metadata", "disc=2/3"], "9/13", "2/3"],
    [["-map_metadata", "-1", "-metadata", "track=2", "-metadata", "disc=1"], "2", "1"],
    [["-metadata", "track=", "-metadata", "disc="], undefined, undefined],
    [["-map_metadata", "-1"], undefined, undefined]
  ] as const) {
    it(`${sync ? "sync" : "async"} M4A numeric tags: ${options.join(" ") || "copy"}`, async () => {
      const base = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: true }));
      const input = serializeMp4({ ...base, tracks: base.tracks.filter(t => t.type === "audio"), metadata: { trackNumber: "3/12", discNumber: "1/2" } });
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.m4a", input);
      const args = ["-i", "/in.m4a", "-c", "copy", ...options, "/out.m4a"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? new Uint8Array(volume.readFileSync(path) as Uint8Array) : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
      } else {
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
        } as never);
        assert.equal(result.exitCode, 0);
      }
      const output = parseMp4(new Uint8Array(volume.readFileSync("/out.m4a") as Uint8Array));
      assert.equal(output.metadata.trackNumber, track);
      assert.equal(output.metadata.discNumber, disc);
      assert.deepEqual(output.tracks[0]!.samples.map(s => s.data), parseMp4(input).tracks[0]!.samples.map(s => s.data));
    });
  }
}
