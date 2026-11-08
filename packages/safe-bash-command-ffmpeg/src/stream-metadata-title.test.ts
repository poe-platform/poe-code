import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const scope of ["s", "s:a:0", "s:a:1", "s:v", "s:a:99", "g"]) {
    it(`keeps ${scope} title metadata scoped (${sync ? "sync" : "async"})`, async () => {
      const doc = parseMp4(createSyntheticMp4({ frameCount: 1, includeAudio: true, metadata: { title: "Meeting" } }));
      const audio = doc.tracks.find(track => track.type === "audio")!;
      const input = serializeMp4({ ...doc, tracks: [
        { ...audio, id: 1, language: "eng" },
        { ...audio, id: 2, language: "fra" }
      ] });
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.mp4", input);
      const args = ["-y", "-i", "/in.mp4", ...(sync ? [] : ["-map", "0:a"]), "-c", "copy",
        `-metadata:${scope}`, "title=Bob", "-metadata:s:a:0", "language=deu", "/out.mp4"];
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
      const output = parseMp4(new Uint8Array(volume.readFileSync("/out.mp4") as Uint8Array));
      assert.equal(output.metadata.title, scope === "g" ? "Bob" : "Meeting");
      assert.deepEqual(output.tracks.map(track => track.language), sync ? ["deu"] : ["deu", "fra"]);
    });
  }
}
