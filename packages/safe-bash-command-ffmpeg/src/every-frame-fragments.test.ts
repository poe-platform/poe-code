import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4, parseMp4Boxes } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const movflags of ["+frag_every_frame", "+frag_every_frame+empty_moov"]) {
  for (const multipleOutputs of [false, true]) {
    it(`stream-copies per-frame fragments with ${movflags} (multiple outputs=${multipleOutputs})`, async () => {
      const doc = parseMp4(createSyntheticMp4({ width: 64, height: 48, frameCount: 12, fps: 4, includeAudio: false }));
      const tracks = doc.tracks.map(track => ({ ...track,
        samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
      }));
      const input = serializeMp4({ ...doc, tracks });
      const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-v", "error", "-y", "-i", "/in.mp4", "-c", "copy", "-movflags", movflags, "/out.mp4", ...(multipleOutputs ? ["-c", "copy", "-movflags", movflags, "/second.mp4"] : [])],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(), stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      for (const path of multipleOutputs ? ["/out.mp4", "/second.mp4"] : ["/out.mp4"]) {
        const bytes = new Uint8Array(volume.readFileSync(path) as Buffer);
        assert.equal(evalSyncFfmpeg(
          ["-y", "-i", "/in.mp4", "-c", "copy", "-movflags", movflags, "/sync.mp4"], undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
        assert.deepEqual(new Uint8Array(volume.readFileSync("/sync.mp4") as Buffer), bytes);
        const output = parseMp4(bytes);
        const moofs = parseMp4Boxes(bytes).filter(box => box.type === "moof");
        const counts = moofs.map(moof => {
          const trun = moof.children!.find(box => box.type === "traf")!.children!.find(box => box.type === "trun")!;
          return new DataView(trun.payload.buffer, trun.payload.byteOffset).getUint32(4);
        });
        assert.deepEqual(counts, movflags.includes("empty_moov") ? Array(12).fill(1) : Array(11).fill(1));
        const initial = parseMp4(bytes.subarray(0, moofs[0]!.offset));
        assert.equal(initial.tracks[0]!.samples.length, movflags.includes("empty_moov") ? 0 : 1);
        assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), tracks[0]!.samples.map(sample => sample.data));
      }
    });
  }
}
