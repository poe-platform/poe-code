import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  for (const mapped of (sync ? [false] : [false, true])) {
    for (const [inputRotation, metadata, displayRotation] of [
      [0, "90", undefined],
      [-90, "0", undefined],
      [0, "0", "90"],
      [-90, "", undefined]
    ] as const) {
      it(`keeps rotate=${metadata} separate from display rotation (input=${inputRotation}, override=${displayRotation}, mapped=${mapped}, sync=${sync})`, async () => {
        const base = parseMp4(createSyntheticMp4({ frameCount: 2 }));
        const input = serializeMp4({ ...base, tracks: base.tracks.map(track => ({ ...track, matrix: undefined, rotation: inputRotation })) });
        const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
        const args = [
          "-y",
          ...(displayRotation === undefined ? [] : ["-display_rotation", displayRotation]),
          "-i", "/in.mp4", ...(mapped ? ["-map", "0:v:0"] : []),
          "-metadata:s:v:0", `rotate=${metadata}`, "-c:v", "copy", "/out.mp4"
        ];
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
        const output = parseMp4(volume.readFileSync("/out.mp4") as Buffer).tracks[0]!;
        const expected = displayRotation === undefined ? parseMp4(input).tracks[0]!.matrix
          : [0, -65536, 0, 65536, 0, 0, 0, 0, 1073741824];
        assert.deepEqual(output.matrix, expected);
        assert.deepEqual(output.samples.map(sample => Array.from(sample.data)), parseMp4(input).tracks[0]!.samples.map(sample => Array.from(sample.data)));
      });
    }
  }
}
