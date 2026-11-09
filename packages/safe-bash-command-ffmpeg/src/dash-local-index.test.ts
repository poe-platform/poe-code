import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { concatBytes, parseMp4, parseMp4Boxes } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";

async function run(flags: string[]) {
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/clean.mp4", readFileSync(new URL("../../mp4-ast/src/fixtures/dash-local-index.mp4", import.meta.url)));
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
  return { result, stderr, volume };
}

for (const flags of [[], ["-streaming", "0"], ["-streaming", "1"]]) {
  it(`writes native DASH chunk structure with ${flags.join(" ") || "default options"}`, async () => {
    const { result, stderr, volume } = await run(flags);
    assert.equal(result.exitCode, 0, stderr);
    const streaming = flags.at(-1) === "1";
    const initialization = volume.readFileSync("/init-stream0.m4s") as Buffer;
    for (let segment = 1; segment <= 4; segment++) {
      const bytes = volume.readFileSync(`/chunk-stream0-${String(segment).padStart(5, "0")}.m4s`) as Buffer;
      const boxes = parseMp4Boxes(bytes);
      assert.deepEqual(boxes.map(box => box.type), streaming ? ["styp", ...Array.from({ length: 8 }, () => ["moof", "mdat"]).flat()] : ["styp", "sidx", "moof", "mdat"]);
      if (!streaming) {
        const sidx = boxes[1]!;
        const view = new DataView(sidx.payload.buffer, sidx.payload.byteOffset);
        // Native FFmpeg 7.0.2 uses this timescale and one second per segment.
        assert.equal(view.getUint8(0), 1);
        assert.equal(view.getUint32(8), 16384);
        assert.equal(view.getBigUint64(12), BigInt((segment - 1) * 16384));
        assert.equal(view.getBigUint64(20), 0n);
        assert.equal(view.getUint16(30), 1);
        assert.equal(view.getUint32(32), boxes[2]!.size + boxes[3]!.size);
        assert.equal(view.getUint32(36), 16384);
      }
      const samples = parseMp4(concatBytes([initialization, bytes])).tracks[0]!.samples;
      assert.equal(samples.length, 8);
      assert.equal(samples[0]!.dts, (segment - 1) * 16384);
    }
  });
}

it("rejects invalid DASH streaming values before writing output", async () => {
  const { result, stderr, volume } = await run(["-streaming", "2"]);
  assert.notEqual(result.exitCode, 0);
  assert.ok(stderr.includes("invalid streaming"), stderr);
  assert.deepEqual(volume.readdirSync("/"), ["clean.mp4"]);
});
