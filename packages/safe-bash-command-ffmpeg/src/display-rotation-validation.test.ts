import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const value of ["oops", "90oops", "", " ", "NaN", "Infinity", "-Infinity", "1e999", "90 45", undefined]) {
    it(`rejects invalid display rotation ${JSON.stringify(value)} before writing (sync=${sync})`, async () => {
      const volume = Volume.fromJSON({
        "/in.mp4": Buffer.from(createSyntheticMp4({ frameCount: 2 })),
        "/out.mp4": "existing output"
      });
      let writes = 0;
      const args = value === undefined ? ["-display_rotation"]
        : ["-y", "-display_rotation", value, "-i", "/in.mp4", "-c:v", "copy", "/out.mp4"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          () => { writes++; return true; }), undefined);
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile() { writes++; },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.notEqual(result.exitCode, 0);
        assert.ok(stderr.includes("display_rotation"), stderr);
      }
      assert.equal(writes, 0);
      assert.equal(volume.readFileSync("/out.mp4", "utf8"), "existing output");
    });
  }

  for (const [value, rotation] of [["0", [65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824]], ["+90", [0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824]], ["-90", [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824]], ["+32.5", [55272, -35212, 0, 35212, 55272, 0, 0, 0, 1073741824]], ["-32.5", [55272, 35212, 0, -35212, 55272, 0, 0, 0, 1073741824]]] as const) {
    it(`preserves valid display rotation ${value} (sync=${sync})`, async () => {
      const base = parseMp4(createSyntheticMp4({ frameCount: 2 }));
      const input = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track, matrix: undefined, rotation: 180 })) });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      const args = ["-y", "-display_rotation", value, "-i", "/in.mp4", "-c:v", "copy", "/out.mp4"];
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
      assert.deepEqual(output.tracks[0]!.matrix, rotation);
      assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), parseMp4(volume.readFileSync("/in.mp4") as Buffer).tracks[0]!.samples.map(sample => sample.data));
    });
  }
}
