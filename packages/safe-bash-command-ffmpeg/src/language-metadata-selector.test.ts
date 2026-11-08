import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const selector of ["m:language:fra", "a:m:language:fra", "v:m:language:fra", "m:language:ita", "m:language", "a:0"]) {
    it(`${sync ? "sync" : "async"} applies language metadata to output selector ${selector}`, async () => {
      const base = parseMp4(createSyntheticMp4({ frameCount: 2, includeAudio: true }));
      const audio = base.tracks.find(track => track.type === "audio")!;
      const input = serializeMp4({ ...base, metadata: { title: "Meeting" }, tracks: [
        { ...audio, id: 1, language: "fra" },
        { ...audio, id: 2, language: "eng" }
      ] });
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.mp4", input);
      const args = ["-i", "/in.mp4", ...(sync ? [] : ["-map", "0:a:1", "-map", "0:a:0"]), "-c", "copy",
        `-metadata:s:${selector}`, "language=deu", "/out.mp4"];
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
      const output = parseMp4(new Uint8Array(volume.readFileSync("/out.mp4") as Uint8Array));
      const before = parseMp4(input).tracks;
      const selected = sync ? before.slice(0, 1) : [...before].reverse();
      const expected = selected.map((track, index) => {
        const matches = selector === "m:language" || (selector === "a:0" ? index === 0
          : (selector === "m:language:fra" || selector === "a:m:language:fra") && track.language === "fra");
        return matches ? "deu" : track.language;
      });
      assert.deepEqual(output.tracks.map(track => track.language), expected);
      assert.equal(output.metadata.title, "Meeting");
      assert.deepEqual(output.tracks.map(track => track.samples.map(sample => sample.data)), selected.map(track => track.samples.map(sample => sample.data)));
    });
  }
}
