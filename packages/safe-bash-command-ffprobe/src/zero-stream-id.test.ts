import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const [fixture, cases] of [
  ["../../mp4-ast/src/fixtures/attachments.mkv", [
    ["#0", [0, 1, 2, 3], [0, 1, 2]],
    ["i:0", [0, 1, 2, 3], [0, 1, 2]],
    ["#0x0", [0, 1, 2, 3], [0, 1, 2]],
    ["a:#0", [0, 1], [0, 1]],
    ["a:i:0", [0, 1], [0, 1]],
    ["0", [0], [0]],
    ["#1", [], []],
    ["i:1", [], []],
  ]],
  ["./fixtures/programs.mpegts", [
    ["#0", [], []],
    ["i:0", [], []],
    ["#0x100", [0], [0]],
    ["i:257", [1], [1]],
    ["a:#0x101", [1], [1]],
  ]],
] as const) {
  const bytes = readFileSync(new URL(fixture, import.meta.url));
  for (const route of ["file", "stdin", "sync"]) {
    for (const [selector, streamIndices, packetIndices] of cases) {
      it(`${fixture} selects ${selector} by effective ID via ${route}`, async () => {
        for (const section of ["stream", "packet"]) {
          const args = ["-v", "error", "-select_streams", selector, "-show_entries",
            section === "stream" ? "stream=index,id" : "packet=stream_index", "-of", "json", route === "stdin" ? "-" : "/input"];
          let output = "", diagnostic = "";
          if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
          else {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/input", bytes);
            const result = await createFfprobeCommand().execute({
              command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
              signal: new AbortController().signal,
              stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
              stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
              stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
            });
            expect(result.exitCode, diagnostic).toBe(0);
            expect(diagnostic).toBe("");
          }
          const parsed = JSON.parse(output);
          if (section === "stream") {
            expect(parsed.streams).toEqual(streamIndices.map(index => fixture.endsWith(".mkv")
              ? { index } : { index, id: `0x10${index}` }));
          } else {
            expect([...new Set(parsed.packets.map((packet: { stream_index: number }) => packet.stream_index))]).toEqual(packetIndices);
          }
        }
      });
    }
  }
}
