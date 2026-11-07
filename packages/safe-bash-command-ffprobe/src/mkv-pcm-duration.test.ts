import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

// Native ffprobe: seven 1024-sample blocks followed by 832 samples, mono PCM16 at 8 kHz.
const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/chapters.mka", import.meta.url));
for (const route of ["file", "stdin"]) it(`uses the actual PCM sample count for Matroska frames and packet durations via ${route}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/meeting.mka", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments([
      "-v", "error", "-of", "json", "-show_packets", "-show_streams", "-show_frames",
      "-show_entries", "packet=pts,duration,size:stream=bit_rate:frame=pts,nb_samples,sample_fmt,channels,duration,duration_time,pkt_duration,pkt_duration_time", route === "stdin" ? "-" : "/meeting.mka"
    ]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  const probe = JSON.parse(output);
  expect(probe.packets_and_frames.filter((record: { type: string }) => record.type === "packet")).toEqual(Array.from({ length: 8 }, (_, i) => ({
    type: "packet", pts: i * 128, duration: i === 7 ? 104 : 128, size: i === 7 ? "1664" : "2048"
  })));
  const frames = probe.packets_and_frames.filter((record: { type: string }) => record.type === "frame");
  expect(frames).toEqual(Array.from({ length: 8 }, (_, i) => ({
    type: "frame", pts: i * 128, nb_samples: i === 7 ? 832 : 1024,
    sample_fmt: "s16", channels: 1,
    duration: i === 7 ? 104 : 128, duration_time: i === 7 ? "0.104000" : "0.128000",
    pkt_duration: i === 7 ? 104 : 128, pkt_duration_time: i === 7 ? "0.104000" : "0.128000"
  })));
  expect(frames.reduce((sum: number, frame: { nb_samples: number }) => sum + frame.nb_samples, 0)).toBe(8000);
  expect(probe.streams[0]).toMatchObject({ bit_rate: "128000" });
});
