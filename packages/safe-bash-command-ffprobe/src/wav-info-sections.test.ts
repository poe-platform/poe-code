import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

for (const section of [undefined, "chapters", "packets", "frames"] as const) {
  for (const explicit of [false, true]) {
    for (const stdin of [false, true]) {
      it(`retains WAV INFO tags with ${section ?? "tags only"}, explicit=${explicit}, stdin=${stdin}`, async () => {
        const tags = { title: "RIFF title", artist: "RIFF artist" };
        const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8000)] }, { tags });
        const fs = new MemoryFileSystem();
        if (!stdin) await fs.writeFile("/info.wav", bytes);
        const args = ["-v", "error", ...(explicit ? ["-f", "wav"] : []), "-show_entries", "format_tags",
          ...(section ? [`-show_${section}`] : []), "-of", "json", stdin ? "-" : "/info.wav"];
        let output = "", diagnostic = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() {
            if (stdin) for (let offset = 0; offset < bytes.length; offset += 257) yield bytes.subarray(offset, offset + 257);
          } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        for (const json of [output, evalSyncFfprobe(stdin ? bytes : undefined, args, () => bytes)!]) {
          const probe = JSON.parse(json);
          expect(probe.format.tags).toEqual(tags);
          if (section === "chapters") expect(probe.chapters).toEqual([]);
          if (section === "packets" || section === "frames") expect(probe[section].length).toBeGreaterThan(0);
        }
      });
    }
  }
}
