import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4, parseMp4Boxes } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const movflags of ["+empty_moov+frag_keyframe", "+empty_moov+skip_trailer", "+empty_moov+frag_keyframe+skip_trailer"]) {
  it(`writes or suppresses the fragment trailer with ${movflags}`, async () => {
    const doc = parseMp4(createSyntheticMp4({ width: 64, height: 48, frameCount: 12, fps: 4, includeAudio: false }));
    const tracks = doc.tracks.map(track => ({ ...track,
      samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
    }));
    const input = serializeMp4({ ...doc, tracks });
    const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input) });
    let stderr = "";
    const args = ["-v", "error", "-y", "-i", "/in.mp4", "-c", "copy", "-movflags", movflags, "/out.mp4"];
    const result = await createFfmpegCommand().execute({
      args,
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
    const bytes = new Uint8Array(volume.readFileSync("/out.mp4") as Buffer);
    assert.equal(evalSyncFfmpeg(args, undefined,
      path => volume.readFileSync(path) as Buffer,
      (path, data) => { volume.writeFileSync(path, data); return true; }), "");
    assert.deepEqual(new Uint8Array(volume.readFileSync("/out.mp4") as Buffer), bytes);
    assert.equal(parseMp4Boxes(bytes).at(-1)!.type, movflags.includes("skip_trailer") ? "mdat" : "mfra");
    const output = parseMp4(bytes);
    const moofs = parseMp4Boxes(bytes).filter(box => box.type === "moof");
    const counts = moofs.map(moof => {
      const trun = moof.children!.find(box => box.type === "traf")!.children!.find(box => box.type === "trun")!;
      return new DataView(trun.payload.buffer, trun.payload.byteOffset).getUint32(4);
    });
    assert.deepEqual(counts, movflags.includes("frag_keyframe") ? [4, 4, 4] : [12]);
    assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), tracks[0]!.samples.map(sample => sample.data));
  });
}
