import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createSyntheticMp4, parseMp4, serializeMp4, parseMp4Boxes } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const first of [undefined, 7, 2147483647]) {
  it(`starts fragment sequence numbers at ${first ?? 1} in both execution paths`, async () => {
    const doc = parseMp4(createSyntheticMp4({ width: 64, height: 48, frameCount: 12, fps: 4, includeAudio: false }));
    const tracks = doc.tracks.map(track => ({ ...track,
      samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: index % 4 === 0 }))
    }));
    const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(serializeMp4({ ...doc, tracks })) });
    const outputArgs = ["-c", "copy", "-movflags", "+empty_moov+frag_keyframe", ...(first === undefined ? [] : ["-fragment_index", String(first)])];
    const args = ["-y", "-i", "/in.mp4", ...outputArgs, "/out.mp4"];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: [...args, "-c", "copy", "-movflags", "+empty_moov+frag_keyframe", "/default.mp4"],
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
    for (const path of ["/out.mp4", "/default.mp4"]) {
      const output = new Uint8Array(volume.readFileSync(path) as Buffer);
      const numbers = parseMp4Boxes(output).filter(box => box.type === "moof").map(moof => {
        const mfhd = moof.children!.find(box => box.type === "mfhd")!;
        return new DataView(output.buffer, output.byteOffset).getUint32(mfhd.offset + 12);
      });
      const start = path === "/out.mp4" ? first ?? 1 : 1;
      assert.deepEqual(numbers, [start, start + 1, start + 2]);
      assert.deepEqual(parseMp4(output).tracks[0]!.samples.map(({ data, dts, pts, duration }) => ({ data, dts, pts, duration })),
        tracks[0]!.samples.map(({ data, dts, pts, duration }) => ({ data, dts, pts, duration })));
    }
  });
}

for (const value of ["0", "-1", "1.5", "2147483648", "invalid", ""]) {
  it(`rejects invalid fragment_index ${JSON.stringify(value)} before writing output`, async () => {
    const input = createSyntheticMp4({ frameCount: 1, includeAudio: false });
    let written = false;
    assert.equal(evalSyncFfmpeg(
      ["-i", "/in.mp4", "-c", "copy", "-fragment_index", value, "/out.mp4"], undefined,
      () => input, () => { written = true; return true; }),
    undefined);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-i", "/in.mp4", "-c", "copy", "-fragment_index", value, "/out.mp4"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile() { return input; },
        async writeFile() { written = true; }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.notEqual(result.exitCode, 0);
    assert.ok(stderr.includes("-fragment_index requires an integer from 1 to 2147483647"), stderr);
    assert.equal(written, false);
  });
}
