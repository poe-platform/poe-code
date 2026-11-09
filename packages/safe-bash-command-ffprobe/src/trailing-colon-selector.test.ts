import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

// Native ffprobe selects all streams of the type when its trailing specifier is empty.
for (const [fixture, selector, indices] of [
  ["attachments.mkv", "a:", [0, 1]],
  ["attachments.mkv", "s:", [2]],
  ["attachments.mkv", "v:", []],
  ["attachments.mkv", "d:", []],
  ["mdhd-language-german.mp4", "d:", [1]],
  ["mdhd-language-german.mp4", "v:", [0]],
] as const) {
  const bytes = readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}`, import.meta.url));
  for (const route of ["file", "stdin", "sync"]) {
    for (const section of ["streams", "packets", "interval"]) {
      if (section === "interval" && route === "sync") continue;
      it(`selects all ${selector} ${section} in ${fixture} via ${route}`, async () => {
        const args = ["-v", "error", "-select_streams", selector, "-of", "json",
          "-show_entries", section === "streams" ? "stream=index" : "stream=index:packet=stream_index",
          ...(section === "interval" ? ["-read_intervals", "%"] : []),
          route === "stdin" ? "-" : "/input"];
        let output = "", diagnostic = "";
        if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes)!;
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile("/input", bytes);
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
        const parsed = JSON.parse(output);
        expect(parsed.streams).toEqual(indices.map(index => ({ index })));
        if (section !== "streams") {
          expect([...new Set(parsed.packets.map((packet: { stream_index: number }) => packet.stream_index))].sort())
            .toEqual(indices);
        }
      });
    }
  }
}
