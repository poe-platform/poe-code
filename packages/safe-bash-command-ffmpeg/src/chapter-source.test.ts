import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

for (const overwrite of ["-y", "-n", undefined]) {
  for (const chapterSource of ["1", "2"]) {
    it(`handles chapter source ${chapterSource} with ${overwrite ?? "no overwrite flag"}`, async () => {
      const plain = createSyntheticMp4({ width: 16, height: 16, fps: 10, frameCount: 10, includeAudio: true });
      const chapters = serializeMp4({ ...parseMp4(plain), chapters: [
        { id: 0, startTimeSeconds: 0, endTimeSeconds: 0.4, title: "Intro" },
        { id: 1, startTimeSeconds: 0.4, endTimeSeconds: 1, title: "Discussion" }
      ] });
      const volume = Volume.fromJSON({
        "/plain.m4a": Buffer.from(plain), "/chapters.mp4": Buffer.from(chapters), "/out.mp4": "existing"
      });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", ...(overwrite ? [overwrite] : []), "-i", "/plain.m4a", "-i", "/chapters.mp4",
          "-map", "0:a:0", "-c", "copy", "-map_chapters", chapterSource, "/out.mp4"],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      if (overwrite !== "-y") {
        assert.equal(result.exitCode, overwrite === "-n" ? 0 : 1);
        assert.match(stderr, /already exists/);
        assert.equal(volume.readFileSync("/out.mp4", "utf8"), "existing");
      } else if (chapterSource === "2") {
        assert.match(stderr, /Invalid chapter input index/);
        assert.equal(volume.statSync("/out.mp4").size, 0);
        assert.equal(result.exitCode, 234);
      } else {
        assert.equal(result.exitCode, 0, stderr);
        assert.deepEqual(parseMp4(volume.readFileSync("/out.mp4") as Buffer).chapters?.map(chapter => chapter.title),
          ["Intro", "Discussion"]);
      }
    });
  }
}
