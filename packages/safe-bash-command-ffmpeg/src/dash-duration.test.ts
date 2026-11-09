import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { concatBytes, parseMp4, parseMp4Boxes } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(flags: string[], output = "/out.mpd") {
  const input = readFileSync(new URL("../../mp4-ast/src/fixtures/dash-duration.mp4", import.meta.url));
  const volume = Volume.fromJSON({ "/clean.mp4": input });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/clean.mp4", "-map", "0", "-c", "copy", ...flags, output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async mkdir(path: string) { volume.mkdirSync(path, { recursive: true }); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { result, stderr, volume, input };
}

for (const duration of ["0.5", "500ms", "00:00:00.5"]) {
  for (const explicitFormat of [false, true]) {
    it(`writes half-second DASH fragments with ${duration} (explicit format=${explicitFormat})`, async () => {
      const { result, stderr, volume, input } = await run([
        "-frag_duration", duration, "-frag_type", "duration", "-seg_duration", "1", ...(explicitFormat ? ["-f", "dash"] : [])
      ]);
      assert.equal(result.exitCode, 0, stderr);
      const initialization = volume.readFileSync("/init-stream0.m4s") as Buffer;
      const source = parseMp4(new Uint8Array(input)).tracks[0]!;
      const manifest = volume.readFileSync("/out.mpd", "utf8");
      const control = await run(["-seg_duration", "1"]);
      assert.equal(manifest, control.volume.readFileSync("/out.mpd", "utf8"));
      assert.equal(volume.readdirSync("/").filter(name => String(name).startsWith("chunk-stream0-")).length, 4);
      for (let segment = 1; segment <= 4; segment++) {
        const bytes = volume.readFileSync(`/chunk-stream0-${String(segment).padStart(5, "0")}.m4s`) as Buffer;
        const boxes = parseMp4Boxes(bytes);
        // Native FFmpeg 7.0.2: two four-frame fragments within each one-second segment.
        assert.deepEqual(boxes.map(box => box.type), ["styp", "sidx", "moof", "mdat", "sidx", "moof", "mdat"]);
        for (const moof of boxes.filter(box => box.type === "moof")) {
          const trun = moof.children!.find(box => box.type === "traf")!.children!.find(box => box.type === "trun")!;
          assert.equal(new DataView(trun.payload.buffer, trun.payload.byteOffset).getUint32(4), 4);
        }
        const samples = parseMp4(concatBytes([initialization, bytes])).tracks[0]!.samples;
        assert.deepEqual(samples.map(({ data, dts, pts }) => ({ data, dts, pts })), source.samples.slice((segment - 1) * 8, segment * 8).map(({ data, dts, pts }) => ({ data, dts, pts })));
      }
    });
  }
}

for (const duration of ["-1", "NaN", "Infinity", "nope", "", "1.1"]) {
  it(`rejects invalid DASH fragment duration ${duration} without writing output`, async () => {
    const { result, volume } = await run(["-f", "dash", "-frag_type", "duration", "-seg_duration", "1", "-frag_duration", duration]);
    assert.notEqual(result.exitCode, 0);
    assert.deepEqual(volume.readdirSync("/"), ["clean.mp4"]);
  });
}

it("keeps MP4 fragment durations in integer microseconds", async () => {
  const { result, stderr } = await run(["-frag_duration", "0.5"], "/out.mp4");
  assert.notEqual(result.exitCode, 0);
  assert.ok(stderr.includes("microseconds"), stderr);
});

it("resolves fragment-duration units independently for DASH and MP4 output groups", async () => {
  const { result, stderr, volume } = await run([
    "-frag_duration", "0.5", "-frag_type", "duration", "-seg_duration", "1", "-f", "dash", "/out.mpd",
    "-c", "copy", "-frag_duration", "500000", "-movflags", "+empty_moov"
  ], "/out.mp4");
  assert.equal(result.exitCode, 0, stderr);
  assert.equal(parseMp4Boxes(volume.readFileSync("/chunk-stream0-00001.m4s") as Buffer).filter(box => box.type === "moof").length, 2);
  assert.equal(parseMp4Boxes(volume.readFileSync("/out.mp4") as Buffer).filter(box => box.type === "moof").length, 8);
});
