import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, parseMkv } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/xvid.avi", import.meta.url));
const reference = parseMp4(readFileSync(new URL("../../mp4-ast/src/fixtures/xvid.mp4", import.meta.url))).tracks[0]!;

for (const sync of [false, true]) {
  for (const format of ["mp4", "mkv"] as const) {
    it(`${sync ? "sync" : "async"} copies XVID AVI video into ${format} as MPEG-4`, async () => {
      const volume = Volume.fromJSON({ "/in.avi": input });
      const args = ["-v", "error", "-i", "/in.avi", ...(sync ? ["-an"] : ["-map", "0:v"]), "-c", "copy", `/out.${format}`];
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
      const output = (format === "mp4" ? parseMp4 : parseMkv)(volume.readFileSync(`/out.${format}`) as Buffer);
      assert.equal(output.tracks.length, 1);
      const track = output.tracks[0]!;
      assert.equal(track.codecDescriptions[0]!.codecName, "mpeg4");
      assert.equal(track.codecDescriptions[0]!.formatFourCC, "mp4v");
      assert.equal(track.width, 48);
      assert.equal(track.height, 32);
      assert.equal(track.samples.length, 8);
      assert.deepEqual(track.samples.map(sample => Buffer.from(sample.data)), reference.samples.map(sample => Buffer.from(sample.data)));
    });
  }
}
