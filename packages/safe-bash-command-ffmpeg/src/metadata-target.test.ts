import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const target of ["x", "a", "X", "x:0", "", "g", "s:a:0"]) {
    it(`${sync ? "sync" : "async"} validates metadata target ${JSON.stringify(target)}`, async () => {
      const input = createSyntheticMp4({ frameCount: 1, includeAudio: true });
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.mp4", input);
      volume.writeFileSync("/out.mp4", input);
      const valid = target === "" || target === "g" || target === "s:a:0";
      const assignment = target === "s:a:0" ? "language=fra" : "title=Meeting";
      const args = ["-y", "-i", "/in.mp4", "-c", "copy", `-metadata:${target}`, assignment, "/out.mp4"];
      if (sync) {
        const result = evalSyncFfmpeg(args, undefined,
          path => volume.existsSync(path) ? new Uint8Array(volume.readFileSync(path) as Uint8Array) : undefined,
          (path, data) => { volume.writeFileSync(path, data); return true; });
        assert.equal(result, valid ? "" : undefined);
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
        assert.equal(result.exitCode, valid ? 0 : 234);
        if (!valid) assert.equal(Buffer.concat(errors).toString(), `ffmpeg: Invalid metadata type ${target[0]}.\n`);
      }
      const output = new Uint8Array(volume.readFileSync("/out.mp4") as Uint8Array);
      if (!valid) assert.deepEqual(output, input);
      else if (target === "s:a:0") assert.equal(parseMp4(output).tracks.find(track => track.type === "audio")?.language, "fra");
      else assert.equal(parseMp4(output).metadata.title, "Meeting");
      assert.deepEqual(new Uint8Array(volume.readFileSync("/in.mp4") as Uint8Array), input);
    });
  }
}
