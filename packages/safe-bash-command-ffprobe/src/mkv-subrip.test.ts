import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe on these exact bytes reports one SubRip packet: Hello at 100 ms.
const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/attachments.mkv", import.meta.url));
for (const route of ["file", "stdin", "sync"]) {
  for (const packets of [false, true]) it(`probes native Matroska SubRip without MP4 sample conversion via ${route}, packets=${packets}`, async () => {
    const args = ["-v", "error", "-of", "json", "-select_streams", "2", "-show_streams", ...(packets ? ["-show_packets"] : []), "-show_frames",
      route === "stdin" ? "-" : "/tracks.mkv"];
    let output = "", diagnostic = "";
    if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
    else {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/tracks.mkv", bytes);
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args),
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
    }
    const probe = JSON.parse(output);
    expect(probe.streams).toHaveLength(1);
    expect(probe.streams[0]).toMatchObject({ index: 2, codec_name: "subrip", codec_type: "subtitle", time_base: "1/1000" });
    const frames = packets ? probe.packets_and_frames.filter((row: { type: string }) => row.type === "frame") : probe.frames;
    expect(frames).toEqual([{ ...(packets ? { type: "frame" } : {}), media_type: "subtitle", pts: 100000, pts_time: "0.100000",
      format: 1, start_display_time: 0, end_display_time: 300, num_rects: 1 }]);
    if (!packets) return;
    probe.packets = probe.packets_and_frames.filter((row: { type: string }) => row.type === "packet");
    expect(probe.packets).toHaveLength(1);
    expect(probe.packets[0]).toMatchObject({ stream_index: 2, pts: 100, dts: 100, duration: 300, size: "5", pos: "5011" });
  });
}
