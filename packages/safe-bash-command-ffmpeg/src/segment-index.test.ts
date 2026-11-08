import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4, parseMp4Boxes } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const movflags of ["+empty_moov+default_base_moof+global_sidx", "+empty_moov+dash", "+empty_moov+global_sidx", "+empty_moov+dash+global_sidx"]) {
  it(`writes segment indexes with ${movflags}`, async () => {
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
    const boxes = parseMp4Boxes(bytes);
    const indexes = boxes.filter(box => box.type === "sidx");
    const moofs = boxes.filter(box => box.type === "moof");
    const global = movflags.includes("global_sidx");
    assert.equal(indexes.length, global ? 1 : 3);
    assert.equal(boxes[2]!.type, "sidx");
    assert.equal(moofs.length, 3);
    for (const [index, box] of indexes.entries()) {
      const view = new DataView(box.payload.buffer, box.payload.byteOffset);
      assert.equal(view.getUint8(0), 1);
      assert.equal(view.getUint32(4), tracks[0]!.id);
      assert.equal(view.getUint32(8), tracks[0]!.timescale);
      assert.equal(Number(view.getBigUint64(12)), index * tracks[0]!.timescale);
      assert.equal(view.getUint16(30), global ? 3 : 1);
      let offset = box.offset + box.size + Number(view.getBigUint64(20));
      for (let ref = 0; ref < view.getUint16(30); ref++) {
        const moof = moofs[global ? ref : index]!;
        const mdat = boxes.find(candidate => candidate.offset === moof.offset + moof.size)!;
        assert.equal(offset, moof.offset);
        assert.equal(view.getUint32(32 + ref * 12), moof.size + mdat.size);
        assert.equal(view.getUint32(36 + ref * 12), tracks[0]!.timescale);
        assert.equal(view.getUint32(40 + ref * 12), 0x90000000);
        offset += view.getUint32(32 + ref * 12);
      }
    }
    const output = parseMp4(bytes);
    assert.deepEqual(output.tracks[0]!.samples.map(sample => sample.data), tracks[0]!.samples.map(sample => sample.data));
  });
}
