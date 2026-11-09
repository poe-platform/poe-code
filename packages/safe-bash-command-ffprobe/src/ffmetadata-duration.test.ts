import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

for (const stdin of [false, true]) {
  for (const chapters of [false, true]) {
    for (const optional of ["auto", "always", "never"]) {
      it(`reports FFmetadata duration with stdin=${stdin}, chapters=${chapters}, optional=${optional}`, async () => {
        const bytes = new TextEncoder().encode(";FFMETADATA1\ntitle=Control\n" +
          (chapters ? "[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=400\n" : ""));
        const fs = new MemoryFileSystem();
        if (!stdin) await fs.writeFile("/input.ffmeta", bytes);
        const args = ["-v", "error", "-show_entries", "format=duration,bit_rate", "-of", "json",
          "-show_optional_fields", optional, stdin ? "-" : "/input.ffmeta"];
        let output = "", diagnostic = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { if (stdin) yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        const expected = { format: chapters ? { duration: "0.400000", bit_rate: "1380" }
          : optional === "always" ? { duration: "N/A", bit_rate: "N/A" } : {} };
        expect(JSON.parse(output)).toEqual(expected);
        expect(JSON.parse(evalSyncFfprobe(stdin ? bytes : undefined, args, () => bytes)!)).toEqual(expected);
      });
    }
  }
}
