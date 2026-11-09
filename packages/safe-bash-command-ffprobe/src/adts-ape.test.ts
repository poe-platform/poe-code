import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe reports 16 AAC packets in both files, and these APE format tags.
const tagged = readFileSync(new URL("./fixtures/adts-ape.aac", import.meta.url));
for (const ape of [false, true]) for (const route of ["file", "stdin", "sync"]) for (const packets of [false, true]) {
  it(`reads ADTS APE metadata=${ape} via ${route}, packets=${packets}`, async () => {
    const bytes = ape ? tagged : tagged.subarray(0, 2996);
    const args = ["-v", "error", "-show_entries",
      `format_tags=title,artist:stream=codec_name${packets ? ":packet=stream_index" : ""}`,
      "-of", "json", route === "stdin" ? "-" : "/in.aac"];
    let output = "", diagnostic = "";
    if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
    else {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.aac", bytes);
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { for (let at = 0; at < bytes.length; at += 7) yield bytes.subarray(at, at + 7); } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
    }
    const result = JSON.parse(output);
    expect(result.streams).toEqual([{ codec_name: "aac" }]);
    expect(result.format?.tags ?? {}).toEqual(ape ? { title: "Meeting", artist: "Alice" } : {});
    if (packets) expect(result.packets).toHaveLength(16);
  });
}
