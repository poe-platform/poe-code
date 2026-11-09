import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { concatBytes, parseMp4, parseMp4Boxes, parseStreamingManifest } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/dash-local-index.mp4", import.meta.url));
const source = parseMp4(input).tracks[0]!;

for (const flags of [[], ["-streaming", "0"], ["-streaming", "1"], ["-streaming", "1", "-frag_type", "none"]]) {
  it(`preserves DASH segments and packets with ${flags.join(" ") || "default fragmentation"}`, async () => {
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/clean.mp4", input);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "clean.mp4", "-map", "0", "-c", "copy", "-f", "dash", "-seg_duration", "1", ...flags, "out.mpd"],
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
    assert.equal(result.exitCode, 0, stderr);
    const manifest = parseStreamingManifest(volume.readFileSync("/out.mpd") as Buffer, "dash");
    assert.equal(manifest.durationSeconds, 4);
    assert.ok(volume.readFileSync("/out.mpd", "utf8").toString().includes('<S t="0" d="16384" r="3"/>'));
    assert.equal(manifest.sequences.length, 1);
    const segments = manifest.sequences[0]!;
    assert.equal(segments.length, 4);
    const initialization = volume.readFileSync("/init-stream0.m4s") as Buffer;
    let sequence = 0;
    for (const [index, segment] of segments.entries()) {
      const bytes = volume.readFileSync(`/${segment.uri}`) as Buffer;
      const boxes = parseMp4Boxes(bytes);
      const streaming = flags[1] === "1";
      // Native FFmpeg 7.0.2: styp, then eight moof/mdat pairs with streaming,
      // or styp, sidx and one moof/mdat pair without it.
      assert.deepEqual(boxes.map(box => box.type), streaming
        ? ["styp", ...Array.from({ length: 8 }, () => ["moof", "mdat"]).flat()]
        : ["styp", "sidx", "moof", "mdat"]);
      for (const moof of boxes.filter(box => box.type === "moof")) {
        assert.equal(new DataView(bytes.buffer, bytes.byteOffset + moof.offset).getUint32(20), ++sequence);
      }
      const samples = parseMp4(concatBytes([initialization, bytes])).tracks[0]!.samples;
      const packet = (sample: typeof samples[number]) => [sample.dts, sample.pts, sample.duration, Buffer.from(sample.data)];
      assert.deepEqual(samples.map(packet), source.samples.slice(index * 8, (index + 1) * 8).map(packet));
    }
  });
}
