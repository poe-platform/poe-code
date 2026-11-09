import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { y4mAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const [rate, timeBase, duration, times, frameDuration] of [
  ["30000:1001", "1001/30000", "0.100100", ["0.000000", "0.033367", "0.066733"], "0.033367"],
  ["25:1", "1/25", "0.120000", ["0.000000", "0.040000", "0.080000"], "0.040000"],
  ["50:2", "1/25", "0.120000", ["0.000000", "0.040000", "0.080000"], "0.040000"]
] as const) {
  it(`reports Y4M ${rate} stream, packet and frame timing in frame ticks`, async () => {
    // The two 4x2 reference clips have these three YUV420 payloads.
    const bytes = Buffer.concat([
      Buffer.from(`YUV4MPEG2 W4 H2 F${rate} Ip A${rate === "30000:1001" ? "2:1 C420mpeg2" : "1:1 C420jpeg"}\n`),
      ...["10171e252c333a41484f565d", "242b323940474e555c636a71", "383f464d545b626970777e85"]
        .flatMap(payload => [Buffer.from("FRAME\n"), Buffer.from(payload, "hex")])
    ]);
    const expected = {
      streams: [{ time_base: timeBase, r_frame_rate: timeBase.split("/").reverse().join("/"),
        avg_frame_rate: timeBase.split("/").reverse().join("/"), start_pts: 0, start_time: "0.000000",
        duration_ts: 3, duration }],
      packets: times.map((time, pts) => ({ pts, dts: pts, pts_time: time, dts_time: time,
        duration: 1, duration_time: frameDuration })),
      frames: times.map((time, pts) => ({ pts, pkt_dts: pts, best_effort_timestamp: pts,
        pts_time: time, pkt_dts_time: time, best_effort_timestamp_time: time,
        duration: 1, duration_time: frameDuration }))
    };
    expect(y4mAst().probe(bytes, { showPackets: true, showFrames: true })).toMatchObject(expected);
    for (const sections of [["-show_streams"], ["-show_streams", "-show_packets"], ["-show_streams", "-show_frames"],
      ["-show_streams", "-show_packets", "-show_frames"]]) {
      const args = ["-v", "error", ...sections, "-of", "json", "/in.y4m"];
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.y4m", bytes);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      for (const text of [output, evalSyncFfprobe(undefined, args, () => bytes)!]) {
        const probe = JSON.parse(text);
        expect(probe.streams).toMatchObject(expected.streams);
        if (sections.includes("-show_packets")) {
          expect(probe.packets ?? probe.packets_and_frames.filter((row: { type: string }) => row.type === "packet"))
            .toMatchObject(expected.packets);
        }
        if (sections.includes("-show_frames")) {
          expect(probe.frames ?? probe.packets_and_frames.filter((row: { type: string }) => row.type === "frame"))
            .toMatchObject(expected.frames);
        }
      }
    }
  });
}
