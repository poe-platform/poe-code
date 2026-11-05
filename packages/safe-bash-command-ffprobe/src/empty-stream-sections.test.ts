import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const fixtures = [
  ...["packet-positions-faststart", "packet-positions-interleaved"].map(name => ({
    name, bytes: readFileSync(new URL(`../../mp4-ast/src/fixtures/${name}.mp4`, import.meta.url))
  })),
  { name: "wav", bytes: encodeWav({ sampleRate: 8000, channels: [new Float64Array(80)] }) }
];

for (const { name, bytes } of fixtures) {
  for (const selection of [["-show_streams"], ["-show_entries", "stream=index"], ["-show_format"]]) {
    it(`emits empty sections only with streams for ${name}: ${selection.join(" ")}`, async () => {
      const args = ["-v", "error", ...selection, "-of", "json", "/input"];
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input", bytes);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      for (const text of [output, evalSyncFfprobe(bytes, [...args.slice(0, -1), "-"])!]) {
        const parsed = JSON.parse(text);
        if (selection[0] === "-show_format") {
          expect(Object.keys(parsed)).toEqual(["format"]);
        } else {
          expect(Object.keys(parsed)).toEqual(["programs", "stream_groups", "streams"]);
          expect(parsed.programs).toEqual([]);
          expect(parsed.stream_groups).toEqual([]);
          expect(parsed.streams.length).toBeGreaterThan(0);
          if (selection[0] === "-show_entries")
            expect(parsed.streams).toEqual(parsed.streams.map((_: unknown, index: number) => ({ index })));
        }
      }
    });
  }
}
