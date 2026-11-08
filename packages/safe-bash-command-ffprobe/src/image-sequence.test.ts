import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1sAAAAASUVORK5CYII=", "base64"));

async function run(names: string[], target: string, extra: string[] = [], maxInputBytes?: number, mtimes?: number[]) {
  const fs = new MemoryFileSystem();
  for (const [index, name] of names.entries()) {
    await fs.writeFile(`/${name}`, png);
    if (mtimes) await fs.utimes(`/${name}`, mtimes[index]!, mtimes[index]!);
  }
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand({ limits: { maxInputBytes } }).execute({
    command: "ffprobe", ...createCommandArguments(["-v", "error", ...extra, "-show_packets", "-show_entries", "packet=pts,pts_time:packet_tags", "-of", "json", target]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  return { ...result, output, diagnostic };
}

it.each([
  { names: ["in1.png", "in2.png"], target: "in%d.png", extra: ["-f", "image2"] },
  { names: ["in000.png", "in001.png"], target: "in%03d.png", extra: [] },
  { names: ["in%3.png", "in%4.png", "in%6.png"], target: "in%%%d.png", extra: ["-f", "image2"] }
])("expands image2 packets for $target", async ({ names, target, extra }) => {
  const result = await run(names, target, extra);
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output)).toEqual({ packets: [{ pts: 0, pts_time: "0.000000" }, { pts: 1, pts_time: "0.040000" }] });
});

it("uses the input frame rate for numbered packets", async () => {
  const result = await run(["in1.png", "in2.png"], "in%d.png", ["-f", "image2", "-framerate", "30000/1001"]);
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).packets[1]).toEqual({ pts: 1, pts_time: "0.033367" });
});

it("rejects a missing sequence", async () => {
  const result = await run(["in5.png"], "in%d.png", ["-f", "image2"]);
  expect(result.exitCode).toBe(1);
});

it("accounts for the total sequence input bytes", async () => {
  const result = await run(["in1.png", "in2.png"], "in%d.png", ["-f", "image2"], png.length);
  expect(result.exitCode).toBe(1);
  expect(result.diagnostic).not.toContain("ENOENT");
});

it("keeps literal image inputs working", async () => {
  const result = await run(["in.png"], "in.png", ["-f", "image2"]);
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).packets).toEqual([{ pts: 0, pts_time: "0.000000" }]);
});

it("leaves sequence expansion to the asynchronous command instead of probing a literal pattern file", () => {
  expect(evalSyncFfprobe(png, ["-f", "image2", "-show_packets", "in%d.png"], () => png)).toBeUndefined();
});

it("does not override an explicitly selected demuxer", async () => {
  const result = await run(["in1.png", "in2.png"], "in%d.png", ["-f", "missing"]);
  expect(result.exitCode).toBe(1);
});

it("reports sequence duration, counts, and frame timestamps consistently", async () => {
  const result = await run(["in1.png", "in2.png"], "in%d.png", ["-f", "image2", "-count_packets", "-count_frames",
    "-show_entries", "stream=duration_ts,duration,time_base,nb_read_packets,nb_read_frames:frame=pts,pts_time"]);
  expect(result.exitCode, result.diagnostic).toBe(0);
  const probe = JSON.parse(result.output);
  expect(probe.streams).toEqual([{ duration_ts: 2, duration: "0.080000", time_base: "1/25", nb_read_packets: "2", nb_read_frames: "2" }]);
  expect(probe.packets_and_frames.filter((row: { type: string }) => row.type === "frame")).toEqual([
    { type: "frame", pts: 0, pts_time: "0.000000" }, { type: "frame", pts: 1, pts_time: "0.040000" }
  ]);
});

it.each([0, 1, 2])("uses image file mtimes in timestamp mode %i", async mode => {
  const result = await run(["in1.png", "in2.png"], "in%d.png", ["-f", "image2", "-ts_from_file", String(mode)], undefined, [1700000000000, 1700000002500]);
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).packets).toEqual(mode === 0
    ? [{ pts: 0, pts_time: "0.000000" }, { pts: 1, pts_time: "0.040000" }]
    : [{ pts: mode === 1 ? 1700000000 : 1700000000000000000, pts_time: "1700000000.000000" },
      { pts: mode === 1 ? 1700000002 : 1700000002500000000, pts_time: mode === 1 ? "1700000002.000000" : "1700000002.500000" }]);
});

it.each([1, 2])("uses literal image mtimes in timestamp mode %i", async mode => {
  const result = await run(["in.png"], "in.png", ["-f", "image2", "-ts_from_file", String(mode)], undefined, [1700000002500]);
  expect(result.exitCode, result.diagnostic).toBe(0);
  expect(JSON.parse(result.output).packets).toEqual([{ pts: mode === 1 ? 1700000002 : 1700000002500000000,
    pts_time: mode === 1 ? "1700000002.000000" : "1700000002.500000" }]);
  expect(evalSyncFfprobe(png, ["-f", "image2", "-ts_from_file", String(mode), "in.png"], () => png)).toBeUndefined();
});

it.each(["-1", "3", "1.5", "no"])("rejects invalid timestamp mode %s", async mode => {
  const result = await run(["in.png"], "in.png", ["-ts_from_file", mode]);
  expect(result.exitCode).toBe(1);
  expect(result.diagnostic).toContain("-ts_from_file requires 0, 1 or 2");
});

it.each([1, 2])("keeps stream and frame timing consistent with file timestamps in mode %i", async mode => {
  const result = await run(["in1.png", "in2.png"], "in%d.png", ["-ts_from_file", String(mode), "-show_entries",
    "stream=time_base,start_pts,start_time,duration:frame=pts,pts_time:format=start_time,duration"], undefined, [1700000002500, 1700000000000]);
  expect(result.exitCode, result.diagnostic).toBe(0);
  const probe = JSON.parse(result.output);
  const pts = mode === 1 ? 1700000002 : 1700000002500000000;
  const time = mode === 1 ? "1700000002.000000" : "1700000002.500000";
  expect(probe.streams).toEqual([{ time_base: mode === 1 ? "1/1" : "1/1000000000", start_pts: pts, start_time: time }]);
  expect(probe.format).toEqual({ start_time: time });
  expect(probe.packets_and_frames.filter((row: { type: string }) => row.type === "frame")).toEqual([
    { type: "frame", pts, pts_time: time },
    { type: "frame", pts: mode === 1 ? 1700000000 : 1700000000000000000, pts_time: "1700000000.000000" }
  ]);
});
