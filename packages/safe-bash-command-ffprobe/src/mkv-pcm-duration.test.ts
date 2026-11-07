import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

// Native ffprobe: seven 1024-sample blocks followed by 832 samples, mono PCM16 at 8 kHz.
const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/chapters.mka", import.meta.url));
for (const route of ["file", "stdin"]) it(`uses the actual PCM sample count for Matroska packet durations via ${route}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/meeting.mka", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments([
      "-v", "error", "-of", "json", "-show_packets", "-show_streams",
      "-show_entries", "packet=pts,duration,size:stream=bit_rate", route === "stdin" ? "-" : "/meeting.mka"
    ]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  const probe = JSON.parse(output);
  expect(probe.packets).toEqual(Array.from({ length: 8 }, (_, i) => ({
    pts: i * 128, duration: i === 7 ? 104 : 128, size: i === 7 ? "1664" : "2048"
  })));
  expect(probe.streams[0]).toMatchObject({ bit_rate: "128000" });
});
