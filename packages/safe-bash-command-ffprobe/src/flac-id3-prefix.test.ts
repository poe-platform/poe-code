import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const name of ["base", "bare", "v3", "v4", "id3only"]) {
  const bytes = readFileSync(new URL(`../../audio-ast/src/fixtures/id3-prefix-${name}.flac`, import.meta.url));
  for (const route of ["file", "stdin", "sync"]) for (const packets of [false, true]) {
    it(`probes ${name} FLAC with leading ID3 via ${route}, packets=${packets}`, async () => {
      const args = ["-v", "error", "-show_entries",
        `format=format_name:format_tags:stream=codec_name,duration_ts${packets ? ":packet=pos,size" : ""}`,
        "-of", "json", route === "stdin" ? "-" : "/no-extension"];
      let output = "", diagnostic = "";
      if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/no-extension", bytes);
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
      expect(result.format.format_name).toBe("flac");
      expect(result.streams).toEqual([{ codec_name: "flac", duration_ts: 1200 }]);
      expect(result.format.tags ?? {}).toEqual(name === "id3only" ? { title: "Field recording", artist: "Ada" }
        : name === "bare" ? {} : { encoder: "Lavf61.1.100" });
      if (packets) {
        const start = name === "bare" ? 42 : name === "id3only" ? 212 : name === "base" ? 90 : 260;
        expect(result.packets).toEqual([{ pos: String(start), size: "280" },
          { pos: String(start + 280), size: "278" }, { pos: String(start + 558), size: "71" }]);
      }
    });
  }
}
