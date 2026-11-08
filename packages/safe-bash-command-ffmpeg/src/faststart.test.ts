import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, parseMp4Boxes } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [flags, faststart] of [
  [[], false],
  [["-faststart"], false],
  [["+faststart"], true],
  [["+faststart-faststart"], false],
  [["-faststart+faststart"], true],
  [["+faststart", "-faststart"], false],
  [["+faststart", "write_colr"], false],
  [["+faststart", "+write_colr"], true],
] as const) {
  for (const mode of ["sync", "async", "multiple"]) {
    const sync = mode === "sync";
    it(`places the movie header correctly for ${JSON.stringify(flags)} (${mode})`, async () => {
      const input = readFileSync(new URL("../../mp4-ast/src/fixtures/packet-positions-faststart.mp4", import.meta.url));
      const volume = Volume.fromJSON({ "/in.mp4": input });
      const args = ["-y", "-i", "/in.mp4", "-c", "copy", ...flags.flatMap(flag => ["-movflags", flag]), "/out.mp4",
        ...(mode === "multiple" ? ["-c", "copy", "/default.mp4"] : [])];
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
      for (const path of mode === "multiple" ? ["/out.mp4", "/default.mp4"] : ["/out.mp4"]) {
        const bytes = new Uint8Array(volume.readFileSync(path) as Buffer);
        const boxes = parseMp4Boxes(bytes);
        assert.equal(boxes.findIndex(box => box.type === "moov") < boxes.findIndex(box => box.type === "mdat"), path === "/out.mp4" && faststart);
        assert.deepEqual(parseMp4(bytes).tracks.map(track => track.samples.map(sample => new Uint8Array(sample.data))),
          parseMp4(input).tracks.map(track => track.samples.map(sample => new Uint8Array(sample.data))));
      }
    });
  }
}
