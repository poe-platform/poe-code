import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

for (const stdin of [false, true]) {
  for (const [sections, indices] of [
    ["", []],
    ["[STREAM]\n[STREAM]\n", [0, 1]],
    ["[STREAM]\ntitle=First\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=400\n" +
      "title=Chapter\n[STREAM]\ntitle=Second\n[STREAM]\n", [0, 1, 2]]
  ] as const) {
    for (const selection of [undefined, "0", "1", "a"]) {
      it(`reports FFmetadata streams with stdin=${stdin}, count=${indices.length}, selection=${selection}`, async () => {
        const bytes = new TextEncoder().encode(";FFMETADATA1\n" + sections);
        const fs = new MemoryFileSystem();
        if (!stdin) await fs.writeFile("/input.ffmeta", bytes);
        const args = ["-v", "error", "-show_entries", "stream=index,codec_type:format=nb_streams", "-of", "json",
          ...(selection ? ["-select_streams", selection] : []), stdin ? "-" : "/input.ffmeta"];
        let output = "", diagnostic = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { if (stdin) yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        const streams = indices.filter(index => selection === undefined || selection === String(index))
          .map(index => ({ index, codec_type: "data" }));
        const expected = { streams, format: { nb_streams: indices.length } };
        expect(JSON.parse(output)).toMatchObject(expected);
        expect(JSON.parse(evalSyncFfprobe(stdin ? bytes : undefined, args, () => bytes)!)).toMatchObject(expected);
      });
    }
  }
}
