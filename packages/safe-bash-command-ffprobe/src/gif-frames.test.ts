import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

// Three 4×4 GIF frames with delays of 10, 90, and 10 centiseconds.
const gif = Uint8Array.from(Buffer.from("R0lGODlhBAAEAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAABAAEAAACBISPCQUAIfkEAFoAAAAsAAAAAAQABACAAIAAAAAAAgSEjwkFACH5BAAKAAAALAAAAAAEAAQAgAAA/wAAAAIEhI8JBQA7", "base64"));

for (const selected of [false, true]) {
  it(`reports native GIF frame durations with selected fields=${selected}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.gif", gif);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe",
      ...createCommandArguments([
        "-v", "error", "-show_frames",
        ...(selected ? ["-show_entries", "frame=pts_time,duration,duration_time,width,height"] : []),
        "-of", "json", "/input.gif"
      ]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    const frames = JSON.parse(output).frames;
    const expected = [
      { pts_time: "0.000000", duration: 10, duration_time: "0.100000", width: 4, height: 4 },
      { pts_time: "0.100000", duration: 90, duration_time: "0.900000", width: 4, height: 4 },
      { pts_time: "1.000000", duration: 10, duration_time: "0.100000", width: 4, height: 4 }
    ];
    if (selected) expect(frames).toEqual(expected);
    else expect(frames).toMatchObject(expected);
    for (const frame of frames) {
      expect(frame).not.toHaveProperty("pkt_duration");
      expect(frame).not.toHaveProperty("pkt_duration_time");
    }
  });
}
