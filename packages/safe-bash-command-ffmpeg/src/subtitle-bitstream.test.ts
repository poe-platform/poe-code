import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker, parseMp4 } from "@poe-code/mp4-ast";
import { filterBitstream } from "./bitstream.js";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("./fixtures/subtitle-framecrc.mp4", import.meta.url));
const track = parseMp4(input, { decodeSubtitles: false }).tracks[0]!;

it("subtitle packet filters preserve timing, other tracks, and source bytes in chain order", () => {
  const other = { ...track, type: "audio" as const };
  const original = track.samples.map(sample => Array.from(sample.data));
  const output = filterBitstream([track, other], "mov2textsub,text2movsub", new MediaBudgetTracker(), "subtitle");
  assert.equal(output[1], other);
  assert.deepEqual(track.samples.map(sample => Array.from(sample.data)), original);
  for (const [i, sample] of output[0]!.samples.entries()) {
    const source = track.samples[i]!;
    const length = source.data[0]! * 256 + source.data[1]!;
    assert.deepEqual({ ...sample, data: Array.from(sample.data) }, { ...source, data: Array.from(source.data.subarray(0, length + 2)) });
  }
});

it("subtitle filters bound payloads and reject invalid chains", () => {
  const withData = (data: Uint8Array) => [{ ...track, samples: [{ ...track.samples[0]!, data }] }];
  for (const data of [new Uint8Array(), new Uint8Array([1])]) {
    assert.throws(() => filterBitstream(withData(data), "mov2textsub", new MediaBudgetTracker(), "subtitle"), /truncated/);
  }
  // Native mov2textsub clamps a declared length to the available packet bytes.
  assert.deepEqual(filterBitstream(withData(new Uint8Array([0, 9, 65])), "mov2textsub",
    new MediaBudgetTracker(), "subtitle")[0]!.samples[0]!.data, new Uint8Array([65]));
  assert.throws(() => filterBitstream(withData(new Uint8Array(65536)), "text2movsub",
    new MediaBudgetTracker(), "subtitle"), /16-bit/);
  assert.throws(() => filterBitstream(withData(new Uint8Array(10)), "text2movsub",
    new MediaBudgetTracker({ maxOutputBytes: 11 }), "subtitle"), /maxOutputBytes/);
  for (const chain of ["", "mov2textsub,", "text2movsub=1", "unknown"]) {
    assert.throws(() => filterBitstream([], chain, new MediaBudgetTracker(), "subtitle"), /Unsupported subtitle bitstream filter/);
  }
});

for (const sync of [false, true]) {
  for (const chain of ["mov2textsub,text2movsub", "text2movsub,mov2textsub"]) {
    it(`applies subtitle packet chains to muxed output (sync=${sync}, chain=${chain})`, async () => {
      const volume = Volume.fromJSON({ "/in.mp4": input });
      const args = ["-i", "/in.mp4", "-c:s", "copy", "-bsf:s", chain, "/out.mp4"];
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
      const result = parseMp4(volume.readFileSync("/out.mp4") as Buffer, { decodeSubtitles: false }).tracks[0]!;
      assert.deepEqual(result.samples.map(sample => Array.from(sample.data)),
        track.samples.map(sample => Array.from(chain.startsWith("text2movsub") ? sample.data
          : sample.data.subarray(0, 2 + sample.data[0]! * 256 + sample.data[1]!))));
    });
  }
}
