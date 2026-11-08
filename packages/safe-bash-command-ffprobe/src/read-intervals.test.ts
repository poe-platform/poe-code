import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

async function probe(interval: string, layout = "faststart", extra: string[] = [], stdin = false) {
  const bytes = readFileSync(new URL(layout === "keyframes" ? "./fixtures/read-intervals-keyframes.mp4"
    : `../../mp4-ast/src/fixtures/${layout.startsWith("h264") ? layout : `packet-positions-${layout}`}.mp4`, import.meta.url));
  const fs = new MemoryFileSystem();
  await fs.writeFile("/clip.mp4", bytes);
  let output = "", diagnostic = "";
  const args = ["-v", "error", "-read_intervals", interval, "-show_packets", "-show_entries", "packet=stream_index,pts_time:packet_side_data=", "-of", "json", ...extra, stdin ? "-" : "/clip.mp4"];
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() { if (stdin) yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  return { ...result, output, diagnostic, args, bytes };
}

// Expected subsets checked against native ffprobe on the same checked-in bytes.
for (const layout of ["faststart", "fragmented", "interleaved"]) {
  for (const interval of ["0%+0.4", "0.5%+0.4", "+0.5%+0.4", "00:00:00.5%+00:00:00.4", "%+#2"]) {
    it(`matches native packet intervals ${interval} (${layout})`, async () => {
      const result = await probe(interval, layout);
      expect(result.exitCode, result.diagnostic).toBe(0);
      const times = layout === "fragmented" ? ["0.400000", "0.600000"] : ["0.000000", "0.200000"];
      const expected = times.map(pts_time => ({ stream_index: 0, pts_time }));
      if (layout === "interleaved" && interval !== "%+#2") expected.push({ stream_index: 1, pts_time: "-0.128000" });
      expect(JSON.parse(result.output).packets).toEqual(expected);
    });
  }
}

it("continues after the consumed interval boundary packet", async () => {
  const result = await probe("%0.4,%+#2");
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).packets.map((row: { pts_time: string }) => row.pts_time))
    .toEqual(["0.000000", "0.200000", "0.600000", "0.800000"]);
});

it("can seek backwards between intervals", async () => {
  const result = await probe("0.6%+0.2,0%+#1");
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).packets.map((row: { pts_time: string }) => row.pts_time))
    .toEqual(["0.000000", "0.000000"]);
});

for (const interval of ["%+#0", "0%+0"]) it(`supports empty intervals ${interval}`, async () => {
  const result = await probe(interval);
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).packets).toEqual([]);
});

for (const interval of ["", "0%1,", "bad", "0%bad", "0%#2", "0%+#-1", "0%+#1.5", "0%1%2"]) it(`rejects malformed interval ${interval}`, async () => {
  const result = await probe(interval);
  expect(result.exitCode).toBe(1);
  expect(result.output).toBe("");
  expect(result.diagnostic).toContain("interval");
});

it("defers interval requests from the synchronous shortcut to the command", async () => {
  const result = await probe("0%+0.4");
  expect(evalSyncFfprobe(new Uint8Array(), result.args, () => result.bytes)).toBeUndefined();
});

for (const [interval, times] of [
  ["1%+#3", ["0.000000", "0.400000", "0.200000"]],
  ["%+0.4,+0.4%+#2", ["0.000000", "0.000000", "0.400000"]],
] as const) it(`preserves decode order and relative seeks with B frames (${interval})`, async () => {
  const result = await probe(interval, "h264-b-frames");
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).packets.map((row: { pts_time: string }) => row.pts_time)).toEqual(times);
});

it("uses the selected audio stream for seeking and interval duration", async () => {
  const result = await probe("0%+0.4", "interleaved", ["-select_streams", "a:0"]);
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).packets).toEqual(["0.000000", "0.128000", "0.256000", "0.384000"]
    .map(pts_time => ({ stream_index: 1, pts_time })));
});

it("counts the packets selected by the interval", async () => {
  const result = await probe("0%+#2", "faststart", ["-count_packets", "-show_entries", "stream=nb_read_packets"]);
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).streams).toEqual([{ nb_read_packets: "2" }]);
});

// Fixture: ffmpeg -f lavfi -i color=size=16x16:rate=10:duration=2
// -c:v libx264 -g 5 -bf 2 -pix_fmt yuv420p -movflags +faststart.
for (const [interval, times] of [
  ["0.6%+#3", ["0.500000", "0.800000", "0.600000"]],
  ["1.1%+0.3", ["1.000000"]],
  ["1.8%+#2", ["1.500000", "1.800000"]],
  ["0.9%+#1,+0.6%+#2", ["0.500000", "1.000000", "1.300000"]],
] as const) it(`seeks to the preceding keyframe across GOPs (${interval})`, async () => {
  const result = await probe(interval, "keyframes");
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).packets.map((row: { pts_time: string }) => row.pts_time)).toEqual(times);
});

it("supports interval replay on staged stdin", async () => {
  const result = await probe("0.6%+0.2,0%+#1", "faststart", [], true);
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).packets.map((row: { pts_time: string }) => row.pts_time))
    .toEqual(["0.000000", "0.000000"]);
});
