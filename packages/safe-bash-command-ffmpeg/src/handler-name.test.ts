import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const selector of ["s:a:0", "s:a:1", "s:0", "s:a", "s", "s:a:9"]) {
    it(`${sync ? "sync" : "async"} writes selected MP4 handler names (${selector})`, async () => {
      const base = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: true }));
      const audio = base.tracks.find(track => track.type === "audio")!;
      const input = serializeMp4({ ...base, metadata: { title: "Meeting" }, tracks: [
        { ...audio, id: 1, handlerName: "Alice", language: "eng" },
        { ...audio, id: 2, handlerName: "Bob", language: "fra", samples: audio.samples.slice(0, 1) }
      ] });
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.mp4", input);
      const args = ["-i", "/in.mp4", ...(sync ? [] : ["-map", "0:a:1", "-map", "0:a:0"]), "-c", "copy",
        `-metadata:${selector}`, "handler_name=First", `-metadata:${selector}`, "handler_name=Guest", "/out.mp4"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? new Uint8Array(volume.readFileSync(path) as Uint8Array) : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
      } else {
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
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
      }
      const output = parseMp4(new Uint8Array(volume.readFileSync("/out.mp4") as Uint8Array));
      const before = parseMp4(input).tracks;
      const selected = sync ? before.slice(0, 1) : [...before].reverse();
      assert.deepEqual(output.tracks.map(track => track.handlerName), selected.map((track, index) =>
        selector === "s" || selector === "s:a" || selector.endsWith(`:${index}`) ? "Guest" : track.handlerName));
      assert.equal(output.metadata.title, "Meeting");
      assert.deepEqual(output.tracks.map(track => track.language), selected.map(track => track.language));
      assert.deepEqual(output.tracks.map(track => track.samples.map(sample => sample.data)), selected.map(track => track.samples.map(sample => sample.data)));
    });
  }
}
