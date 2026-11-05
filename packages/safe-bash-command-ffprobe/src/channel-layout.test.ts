import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";

for (const codec of ["flac", "mp3"]) for (const [channels, layout] of [[1, "mono"], [2, "stereo"]] as const) {
  for (const route of ["file", "stdin"]) for (const extra of [[], ["-f", codec], ["-count_packets"]]) {
    it(`reports ${codec} ${layout} via ${route} with ${extra.join(" ")}`, async () => {
      const bytes = new Uint8Array(codec === "flac" ? 42 : 834);
      if (codec === "flac") {
        bytes.set([102, 76, 97, 67, 128, 0, 0, 34]);
        new DataView(bytes.buffer).setBigUint64(18, (48000n << 44n) | (BigInt(channels - 1) << 41n) | (15n << 36n) | 12000n);
      } else {
        bytes.set([255, 251, 144, channels === 1 ? 192 : 0]);
        bytes.set(bytes.subarray(0, 4), 417);
      }
      const fs = new MemoryFileSystem();
      await fs.writeFile(`/input.${codec}`, bytes);
      for (const writer of ["json", "default", "csv", "flat", "compact"]) for (const selection of [["-show_entries", "stream=channel_layout"], ["-show_streams"]]) {
        let output = "", diagnostic = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments([
            ...extra, ...selection, "-of", writer,
            route === "stdin" ? "-" : `/input.${codec}`
          ]), cwd: "/", env: {}, fs, signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        if (writer === "json") {
          const streams = JSON.parse(output).streams;
          if (selection[0] === "-show_entries") expect(streams).toEqual([{ channel_layout: layout }]);
          else expect(streams[0]).toMatchObject({ channels, channel_layout: layout });
        }
        else expect(output).toContain(layout);
      }
    });
  }
}
