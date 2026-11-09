import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Unchanged WebVTT bytes used to verify these counts against native ffprobe.
const bytes = readFileSync(new URL("./fixtures/voices.vtt", import.meta.url));

for (const route of ["file", "stdin"]) {
  it.each([
    [[], {}],
    [["-show_packets"], { nb_read_packets: "2" }],
    [["-show_frames"], { nb_read_frames: "2" }],
    [["-show_packets", "-show_frames"], { nb_read_packets: "2", nb_read_frames: "2" }],
    [["-count_packets", "-count_frames"], { nb_read_packets: "2", nb_read_frames: "2" }],
    [["-show_entries", "packet=pts:frame=pts"], { nb_read_packets: "2", nb_read_frames: "2" }]
  ] as const)(`reports counts for requested WebVTT records via ${route}: %j`, async (selection, counts) => {
    const args = ["-v", "error", ...selection, "-show_entries",
      "stream=nb_read_packets,nb_read_frames", "-of", "json", route === "file" ? "/voices.vtt" : "-"];
    const fs = new MemoryFileSystem();
    await fs.writeFile("/voices.vtt", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { if (route === "stdin") yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    for (const value of [output, evalSyncFfprobe(route === "stdin" ? bytes : undefined, args, () => bytes)!]) {
      const probe = JSON.parse(value);
      expect(probe.streams).toEqual([counts]);
      if (args.includes("-show_packets") && args.includes("-show_frames")) {
        expect(probe.packets_and_frames).toHaveLength(4);
      } else if (args.includes("-show_packets")) expect(probe.packets).toHaveLength(2);
      else if (args.includes("-show_frames")) expect(probe.frames).toHaveLength(2);
    }
  });
}
