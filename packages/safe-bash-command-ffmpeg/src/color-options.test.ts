import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { parseMp4, parseMp4Boxes, serializeMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2: plain 32x16 H.264 without color metadata.
const plain = readFileSync(new URL("./fixtures/color-plain.mp4", import.meta.url));
const sdr = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"];
const hdr = ["-color_primaries", "bt2020", "-color_trc", "smpte2084", "-colorspace", "bt2020nc", "-color_range", "pc"];

async function copy(sync: boolean, options: string[], input: Uint8Array = plain, valid = true) {
  const volume = Volume.fromJSON({ "/in.mp4": Buffer.from(input), "/out.mp4": "KEEP" });
  const args = ["-y", "-i", "/in.mp4", ...(sync ? [] : ["-map", "0:v"]), "-c:v", "copy", ...options, "/out.mp4"];
  if (sync) {
    const result = evalSyncFfmpeg(args, undefined, path => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined,
      (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
    assert.equal(result, valid ? "" : undefined);
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
    assert.equal(result.exitCode, valid ? 0 : 234, stderr);
  }
  const output = volume.readFileSync("/out.mp4") as Buffer;
  if (!valid) { assert.equal(output.toString(), "KEEP"); return []; }
  const original = parseMp4(new Uint8Array(input));
  return parseMp4(new Uint8Array(output)).tracks.map((track, index) => {
    assert.deepEqual(track.samples.map(sample => sample.data), original.tracks[index]!.samples.map(sample => sample.data));
    assert.deepEqual(track.codecDescriptions[0]!.avcC?.rawBytes, original.tracks[index]!.codecDescriptions[0]!.avcC?.rawBytes);
    const entry = track.codecDescriptions[0]!.rawStsdEntryBytes!;
    return parseMp4Boxes(entry.subarray(86)).filter(box => box.type === "colr").map(box => Buffer.from(box.payload).toString("hex"));
  });
}

for (const sync of [false, true]) {
  for (const fragmented of [false, true]) {
    for (const [name, options, expected] of [
      ["unchanged", [], []],
      ["SDR", sdr, ["6e636c7800010001000100"]],
      ["HDR", hdr, ["6e636c7800090010000980"]],
      ["numeric HDR", ["-color_primaries", "9", "-color_trc", "16", "-colorspace", "9", "-color_range", "2"], ["6e636c7800090010000980"]]
    ] as const) {
      it(`copies ${name} color tags (sync=${sync}, fragmented=${fragmented})`, async () => {
        assert.deepEqual(await copy(sync, [...options, ...(fragmented ? ["-movflags", "+frag_keyframe+empty_moov"] : [])]), [expected]);
      });
    }
  }
  for (const [option, value, fields] of [
    ["-color_primaries", "bt2020", "00090002000200"],
    ["-color_trc", "smpte2084", "00020010000200"],
    ["-colorspace", "bt2020nc", "00020002000900"],
    ["-color_range", "pc", "00020002000280"],
    ["-color_range", "jpeg", "00020002000280"],
    ["-color_trc", "bt2020_10bit", "0002000e000200"]
  ]) {
    it(`copies individual ${option}=${value} (sync=${sync})`, async () => {
      assert.deepEqual(await copy(sync, [option!, value!, "-movflags", "+write_colr"]), [[`6e636c78${fields}`]]);
      assert.deepEqual(await copy(sync, [option!, value!]), [[]]);
    });
  }
  for (const option of ["-color_primaries", "-color_trc", "-colorspace", "-color_range"]) {
    for (const value of ["bogus", "-1", "2147483648"]) {
      it(`preserves the destination for invalid ${option}=${value} (sync=${sync})`, async () => {
        await copy(sync, [option, value], plain, false);
      });
    }
  }
  it(`updates existing tags without duplicating colr (sync=${sync})`, async () => {
    const input = serializeMp4(parseMp4(plain), { writeColr: true });
    const entry = parseMp4(input).tracks[0]!.codecDescriptions[0]!.rawStsdEntryBytes!;
    const colr = parseMp4Boxes(entry.subarray(86)).find(box => box.type === "colr")!;
    colr.payload.set([0, 9, 0, 16, 0, 9, 128], 4);
    assert.deepEqual(await copy(sync, ["-color_range:v:0", "tv"], input), [["6e636c7800090010000900"]]);
    assert.deepEqual(await copy(sync, sdr, input), [["6e636c7800010001000100"]]);
    assert.deepEqual(await copy(sync, ["-color_primaries", "unknown"], input), [[]]);
    assert.deepEqual(await copy(sync, ["-color_primaries", "unknown", "-movflags", "+write_colr"], input), [["6e636c7800020010000980"]]);
  });
  it(`uses the last matching output color option (sync=${sync})`, async () => {
    assert.deepEqual(await copy(sync, [...sdr, "-color_primaries:v:0", "bt2020"]), [["6e636c7800090001000100"]]);
  });
}

it("applies output color specifiers after mapping", async () => {
  const doc = parseMp4(plain);
  const input = serializeMp4({ ...doc, tracks: [doc.tracks[0]!, { ...doc.tracks[0]!, id: 2 }] });
  assert.deepEqual(await copy(false, [...sdr, "-color_primaries:v:1", "bt2020", "-color_range:1", "pc"], input),
    [["6e636c7800010001000100"], ["6e636c7800090001000180"]]);
});
