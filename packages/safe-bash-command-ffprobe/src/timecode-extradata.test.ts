import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe output for the unchanged normal and drop-frame QuickTime fixtures.
for (const [name, hex, dump] of [
  ["tagged", "0000000000000000000032000000020019000000",
    "\n00000000: 0000 0000 0000 0000 0000 3200 0000 0200  ..........2.....\n00000010: 1900 0000                                ....\n"],
  ["drop", "000000000000000100007530000003e91e000000",
    "\n00000000: 0000 0000 0000 0001 0000 7530 0000 03e9  ..........u0....\n00000010: 1e00 0000                                ....\n"]
] as const) {
  const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/timecode-${name}.mp4`, import.meta.url));
  for (const route of ["file", "stdin", "readFile", "sync"]) {
    for (const flags of [[], ["-show_data"], ["-show_data_hash", "sha256"], ["-show_data", "-show_data_hash", "sha256"]]) {
      it(`reports ${name} timecode description independently of its packet (${route}, ${flags.join(" ")})`, async () => {
        const args = ["-v", "error", "-select_streams", "1", ...flags,
          "-show_entries", "stream=extradata,extradata_size,extradata_hash:packet=size", "-of", "json",
          route === "stdin" ? "pipe:0" : "/in.mp4"];
        let output = "", diagnostic = "";
        if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes)!;
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile("/in.mp4", bytes);
          if (route === "readFile") Object.defineProperty(fs, "openFile", { value: undefined });
          const result = await createFfprobeCommand().execute({
            command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: { async *[Symbol.asyncIterator]() { if (route === "stdin") yield bytes; } },
            stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
          });
          expect(result.exitCode, diagnostic).toBe(0);
          expect(diagnostic).toBe("");
        }
        expect(JSON.parse(output)).toEqual({
          programs: [], stream_groups: [], packets: [{ size: "4" }],
          streams: [{ extradata_size: 20,
            ...(flags.includes("-show_data") ? { extradata: dump } : {}),
            ...(flags.includes("-show_data_hash") ? {
              extradata_hash: "SHA256:" + createHash("sha256").update(Buffer.from(hex, "hex")).digest("hex")
            } : {})
          }]
        });
      });
    }
  }
}
