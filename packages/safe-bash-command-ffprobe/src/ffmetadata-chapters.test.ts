import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = new TextEncoder().encode(`;FFMETADATA1
[CHAPTER]
TIMEBASE=1/25
START=0
END=3
title=Clock
[CHAPTER]
TIMEBASE=2/50
START=3
END=6
[CHAPTER]
TIMEBASE=1/1000
START=240
END=300
[CHAPTER]
TIMEBASE=1/48000
START=14401
END=14449
`);
const chapters = [
  { id: 0, time_base: "1/25", start: 0, start_time: "0.000000", end: 3, end_time: "0.120000", tags: { title: "Clock" } },
  { id: 1, time_base: "2/50", start: 3, start_time: "0.120000", end: 6, end_time: "0.240000", tags: {} },
  { id: 2, time_base: "1/1000", start: 240, start_time: "0.240000", end: 300, end_time: "0.300000", tags: {} },
  { id: 3, time_base: "1/48000", start: 14401, start_time: "0.300021", end: 14449, end_time: "0.301021", tags: {} }
];

for (const target of ["/clock.ffmeta", "-"]) {
  it(`preserves each FFmetadata chapter clock through ffprobe ${target}`, async () => {
    const args = ["-v", "error", "-show_chapters", "-of", "json", target];
    const fs = new MemoryFileSystem();
    await fs.writeFile("/clock.ffmeta", bytes);
    let output = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: (async function* () { yield bytes; })(),
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
    });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(output).chapters).toEqual(chapters);
    expect(JSON.parse(evalSyncFfprobe(target === "-" ? bytes : undefined, args, () => bytes)!).chapters).toEqual(chapters);
  });
}
