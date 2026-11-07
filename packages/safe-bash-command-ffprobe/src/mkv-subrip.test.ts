import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe on these exact bytes reports one SubRip packet: Hello at 100 ms.
const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/attachments.mkv", import.meta.url));
for (const route of ["file", "stdin", "sync"]) {
  it(`probes native Matroska SubRip without MP4 sample conversion via ${route}`, async () => {
    const args = ["-v", "error", "-of", "json", "-select_streams", "2", "-show_streams", "-show_packets",
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
    expect(probe.packets).toHaveLength(1);
    expect(probe.packets[0]).toMatchObject({ stream_index: 2, pts: 100, dts: 100, duration: 300, size: "5", pos: "5011" });
  });
}
