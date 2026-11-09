import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe output for these exact WebVTT bytes.
const bytes = new TextEncoder().encode("WEBVTT\n\na\n00:01.250 --> 00:02.750 align:start\nOne\nTwo\n\n00:04.000 --> 00:04.500\nThree\n");
const frames = [
  { media_type: "subtitle", pts: 1250000, pts_time: "1.250000", format: 1, start_display_time: 0, end_display_time: 1500, num_rects: 1 },
  { media_type: "subtitle", pts: 4000000, pts_time: "4.000000", format: 1, start_display_time: 0, end_display_time: 500, num_rects: 1 }
];

for (const route of ["file", "stdin", "sync"]) {
  for (const packets of [false, true]) it(`reports decoded WebVTT subtitle frames via ${route}, packets=${packets}`, async () => {
    const args = ["-v", "error", "-of", "json", "-select_streams", "s", "-show_frames", ...(packets ? ["-show_packets"] : []),
      route === "stdin" ? "-" : "/voices.vtt"];
    let output = "", diagnostic = "";
    if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
    else {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/voices.vtt", bytes);
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(diagnostic).toBe("");
    }
    const probe = JSON.parse(output);
    if (!packets) {
      expect(probe.frames).toEqual(frames);
      return;
    }
    expect(probe.packets_and_frames).toEqual([
      expect.objectContaining({ type: "packet", pts: 1250, pts_time: "1.250000", dts: 1250, duration: 1500, duration_time: "1.500000", size: "7" }),
      { type: "frame", ...frames[0] },
      expect.objectContaining({ type: "packet", pts: 4000, pts_time: "4.000000", dts: 4000, duration: 500, duration_time: "0.500000", size: "5" }),
      { type: "frame", ...frames[1] }
    ]);
  });
}
