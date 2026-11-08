import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const audioOnly of [true, false]) {
  for (const selector of audioOnly ? ["v", "a:99", "m:language:deu", "a:0"] : ["a", "v:99", "v:0"]) {
    it(`evaluates disposition values only for matched ${audioOnly ? "audio" : "video"} output (${selector})`, async () => {
      const doc = parseMp4(createSyntheticMp4({ width: 16, height: 16, fps: 1, frameCount: 1, includeAudio: true }));
      const track = doc.tracks.find(track => track.type === (audioOnly ? "audio" : "video"))!;
      const input = serializeMp4({ ...doc, tracks: audioOnly ? [
        { ...track, id: 1, language: "eng", enabled: true },
        { ...track, id: 2, language: "fra", enabled: false }
      ] : [track] });
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.mp4", input);
      const matches = selector.endsWith(":0");
      const args = ["-y", "-i", "/in.mp4", ...(audioOnly ? ["-map", "0:a"] : []), "-c", "copy", `-disposition:${selector}`, "notreal", "/out.mp4"];
      if (!audioOnly) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? new Uint8Array(volume.readFileSync(path) as Uint8Array) : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; }), matches ? undefined : "");
      }
      const errors: Uint8Array[] = [];
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { errors.push(data); } }
      } as never);
      assert.equal(result.exitCode, matches ? 1 : 0, Buffer.concat(errors).toString());
      if (matches) {
        assert.ok(Buffer.concat(errors).toString().includes("Unsupported disposition: notreal"));
      } else {
        const output = parseMp4(new Uint8Array(volume.readFileSync("/out.mp4") as Uint8Array));
        const before = parseMp4(input);
        assert.deepEqual(output.tracks.map(track => [track.language, track.enabled]), before.tracks.map(track => [track.language, track.enabled]));
        assert.deepEqual(output.tracks.map(track => track.samples.map(sample => sample.data)), before.tracks.map(track => track.samples.map(sample => sample.data)));
      }
    });
  }
}
