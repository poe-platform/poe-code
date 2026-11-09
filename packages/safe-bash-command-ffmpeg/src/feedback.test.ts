import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { MediaBudgetTracker, decodeH264Samples, parseMp4 } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "./index.js";
import { applyFeedback } from "./feedback.js";

const source = readFileSync(new URL("./fixtures/feedback-source.mp4", import.meta.url));
const native = readFileSync(new URL("./fixtures/feedback-native.mp4", import.meta.url));
const graph = "[0:v][back]feedback=x=8:y=4:w=16:h=8[out][tile];[tile]negate[back]";

function decode(bytes: Uint8Array) {
  const doc = parseMp4(bytes);
  const track = doc.tracks.find(track => track.type === "video")!;
  let offset = 0;
  for (const edit of track.editList ?? []) {
    if (edit.mediaTime < 0) offset -= edit.segmentDuration / doc.timescale;
    else { offset += edit.mediaTime / track.timescale; break; }
  }
  return [...decodeH264Samples(track.samples, track.codecDescriptions, track.width!, track.height!, track.timescale)]
    .map(frame => ({ ...frame, ptsSeconds: frame.ptsSeconds - offset }));
}

async function run(filter: string, extra: string[] = [], map = "[out]") {
  const volume = Volume.fromJSON({ "/out.mp4": "keep existing output" });
  volume.writeFileSync("/source.mp4", source);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/source.mp4", ...extra,
      "-filter_complex", filter, "-map", map, "-c:v", "libx264", "/out.mp4"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stderr, bytes: volume.readFileSync("/out.mp4") as Buffer };
}

it("filters only the feedback rectangle in every frame through the public MP4 invocation", async () => {
  const result = await run(graph);
  assert.equal(result.exitCode, 0, result.stderr);
  const actual = decode(result.bytes);
  const reference = decode(native);
  assert.equal(actual.length, 3);
  assert.deepEqual(actual.map(frame => [frame.width, frame.height, frame.ptsSeconds, frame.durationSeconds]),
    reference.map(frame => [frame.width, frame.height, frame.ptsSeconds, frame.durationSeconds]));
  for (let n = 0; n < actual.length; n++) {
    const pixels = actual[n]!.native!.pixels;
    const expected = reference[n]!.native!.pixels;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
      const inside = x >= 8 && x < 24 && y >= 4 && y < 12;
      assert.ok(Math.abs(pixels[y * 32 + x]! - expected[y * 32 + x]!) <= (inside ? 2 : 0),
        `frame ${n}, pixel ${x},${y}: ${pixels[y * 32 + x]} != ${expected[y * 32 + x]}`);
    }
  }
});

it("routes renamed labels and a chained return branch independently of declaration order", async () => {
  const result = await run("[part]negate[mid];[mid]null[return];[1:v:0][return]feedback@region=8:4:16:8[done][part]",
    ["-i", "/source.mp4"], "[done]");
  assert.equal(result.exitCode, 0, result.stderr);
  const original = await run(graph);
  assert.equal(original.exitCode, 0, original.stderr);
  assert.deepEqual(decode(result.bytes), decode(original.bytes));
});

it("uses the remaining frame for default feedback dimensions", async () => {
  const result = await run("[0:v][back]feedback=x=8:y=4[out][tile];[tile]negate[back]");
  assert.equal(result.exitCode, 0, result.stderr);
  for (const [n, frame] of decode(result.bytes).entries()) {
    const pixels = frame.native!.pixels;
    assert.ok(Math.abs(pixels[15 * 32 + 31]! - (223 - n * 32)) <= 2);
    assert.equal(pixels[0], 32 + n * 32);
  }
});

for (const [filter, map, error] of [
  [graph.replace("x=8", "x=-1"), "[out]", "feedback"],
  [graph.replace("w=16", "w=invalid"), "[out]", "feedback"],
  [graph.replace("w=16", "unknown=16"), "[out]", "feedback"],
  [graph.replace("[tile]negate", "[missing]negate"), "[out]", "feedback"],
  [graph, "[missing]", "feedback"],
  [graph.replace("negate", "scale=2:2"), "[out]", "feedback"],
] as const) {
  it(`rejects invalid feedback routing/options without replacing output: ${filter} ${map}`, async () => {
    const result = await run(filter, [], map);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes(error), result.stderr);
    assert.equal(result.bytes.toString(), "keep existing output");
  });
}

it("copies RGBA feedback pixels including alpha without mutating the source", async () => {
  const data = Uint8Array.from({ length: 4 * 3 * 4 }, (_, i) => i * 3);
  const frame = { width: 4, height: 3, data, ptsSeconds: 2, durationSeconds: 0.5, keyframe: true };
  const original = new Uint8Array(data);
  const result = await applyFeedback([frame], { x: 1, y: 1, w: 2, h: 1 }, async tiles => tiles.map(tile =>
    ({ ...tile, data: tile.data.map(value => 255 - value) })), new MediaBudgetTracker());
  const expected = new Uint8Array(original);
  for (let i = 20; i < 28; i++) expected[i] = 255 - expected[i]!;
  assert.deepEqual(result[0], { ...frame, data: expected });
  assert.deepEqual(data, original);
});

it("enforces feedback memory limits and cancellation before processing the return branch", async () => {
  const frame = { width: 4, height: 3, data: new Uint8Array(48), ptsSeconds: 0, durationSeconds: 1, keyframe: true };
  const rectangle = { x: 0, y: 0, w: 4, h: 3 };
  await assert.rejects(applyFeedback([frame], rectangle, async () => {
    assert.fail("memory limit must be checked first");
  }, new MediaBudgetTracker({ maxMemoryBytes: 1 })), /maxMemoryBytes/);
  await assert.rejects(applyFeedback([frame], rectangle, async () => {
    assert.fail("cancellation must be checked first");
  }, new MediaBudgetTracker(), AbortSignal.abort()), { name: "AbortError" });
});

it("applies output scaling after restoring the feedback rectangle", async () => {
  const result = await run(graph, ["-s", "16x8"]);
  assert.equal(result.exitCode, 0, result.stderr);
  const frames = decode(result.bytes);
  assert.equal(frames.length, 3);
  assert.deepEqual(frames.map(frame => [frame.width, frame.height]), [[16, 8], [16, 8], [16, 8]]);
});
