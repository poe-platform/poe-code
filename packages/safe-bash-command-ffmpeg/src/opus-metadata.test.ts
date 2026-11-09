import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker, parseMkv, serializeMkv } from "@poe-code/mp4-ast";
import { filterBitstream } from "./bitstream.js";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native 0.75-second mono Opus fixture: 38 compressed packets.
const input = readFileSync(new URL("./fixtures/opus-gain.mkv", import.meta.url));
for (const sync of [false, true]) for (const initial of [0, 1536]) {
  for (const gain of [undefined, "null", "opus_metadata", 1536, -1536, 0, -32768, 32767]) {
    it(`replaces Opus gain ${initial} with ${gain} (sync=${sync})`, async () => {
      const source = parseMkv(new Uint8Array(input));
      const head = source.tracks[0]!.codecDescriptions[0]!.extraData!;
      new DataView(head.buffer, head.byteOffset, head.byteLength).setInt16(16, initial, true);
      const bytes = serializeMkv(source);
      const volume = Volume.fromJSON({ "/in.mkv": Buffer.from(bytes) });
      const filter = typeof gain === "number" ? `null,opus_metadata=gain=${gain},null` : gain;
      const args = ["-y", "-i", "/in.mkv", "-c:a", "copy", ...(filter ? ["-bsf:a", filter] : []), "/out.mkv"];
      if (sync) {
        assert.equal(evalSyncFfmpeg(args, undefined,
          path => volume.readFileSync(path) as Buffer,
          (path, data) => { volume.writeFileSync(path, data); return true; }), "");
      } else {
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args, cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(), stdout: { async write() {} },
          stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
      }
      const track = parseMkv(new Uint8Array(volume.readFileSync("/out.mkv") as Buffer)).tracks[0]!;
      const outputHead = track.codecDescriptions[0]!.extraData!;
      assert.equal(new DataView(outputHead.buffer, outputHead.byteOffset, outputHead.byteLength).getInt16(16, true), typeof gain === "number" ? gain : gain === "opus_metadata" ? 0 : initial);
      assert.equal(track.samples.length, 38);
      assert.deepEqual(track.samples, parseMkv(bytes).tracks[0]!.samples);
      assert.equal(new DataView(head.buffer, head.byteOffset, head.byteLength).getInt16(16, true), initial);
    });
  }
}

for (const option of ["gain=32768", "gain=-32769", "gain=1.5", "gain=", "gain=NaN", "gain=1=2", "unknown=1"]) {
  it(`rejects invalid Opus metadata ${option} before writing output`, () => {
    let writes = 0;
    assert.equal(evalSyncFfmpeg(["-y", "-i", "/in.mkv", "-c:a", "copy", "-bsf:a", `opus_metadata=${option}`, "/out.mkv"], undefined,
      () => input, () => { writes++; return true; }), undefined);
    assert.equal(writes, 0);
  });
}

it("validates the codec and OpusHead without mutating the source", () => {
  const tracks = parseMkv(new Uint8Array(input)).tracks;
  const head = tracks[0]!.codecDescriptions[0]!.extraData!;
  const original = new Uint8Array(head);
  filterBitstream(tracks, "opus_metadata=gain=1536", new MediaBudgetTracker(), "audio");
  assert.deepEqual(head, original);
  for (const codec of [
    { codecName: "aac", extraData: head },
    { codecName: "opus", extraData: head.subarray(0, 18) },
    { codecName: "opus", extraData: new Uint8Array(19) }
  ]) {
    assert.throws(() => filterBitstream([{ ...tracks[0]!, codecDescriptions: [{ ...tracks[0]!.codecDescriptions[0]!, ...codec }] }],
      "opus_metadata=gain=1536", new MediaBudgetTracker(), "audio"), /opus_metadata/);
  }
});
