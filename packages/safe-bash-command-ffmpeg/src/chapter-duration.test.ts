import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const duration of ["0.25", "0.4", undefined]) {
    it(`omits chapters beyond output duration ${duration ?? "unlimited"} (${sync ? "sync" : "async"})`, async () => {
      const plain = createSyntheticMp4({ width: 16, height: 16, fps: 10, frameCount: 10, includeAudio: true });
      const chapters = serializeMp4({ ...parseMp4(plain), chapters: [
        { id: 0, startTimeSeconds: 0, endTimeSeconds: 0.4, title: "Intro" },
        { id: 1, startTimeSeconds: 0.4, endTimeSeconds: 1, title: "Discussion" }
      ] });
      const volume = Volume.fromJSON({ "/chapters.mp4": Buffer.from(chapters), "/plain.m4a": Buffer.from(plain) });
      const args = ["-y", "-v", "error", "-i", "/chapters.mp4", "-i", "/plain.m4a", ...(sync ? ["-vn"] : ["-map", "0:a:0"]), "-c", "copy",
        ...(duration ? ["-t", duration] : []), "/out.mp4"];
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
      const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer);
      assert.deepEqual(output.chapters?.map(chapter => chapter.title), duration === "0.25" ? ["Intro"] : ["Intro", "Discussion"]);
      assert.equal(output.chapters?.[0]?.startTimeSeconds, 0);
      // QuickTime chapter samples retain the requested end even when copied audio
      // packets extend the container duration beyond it.
      assert.equal(output.chapters?.[0]?.endTimeSeconds, duration ? Number(duration) : 0.4);
    });
  }
}
