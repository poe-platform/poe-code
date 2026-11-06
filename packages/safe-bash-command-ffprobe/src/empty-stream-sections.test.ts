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
  for (const [selection, keys] of [
    [["-show_streams"], ["streams"]],
    [["-show_streams", "-show_format"], ["streams", "format"]],
    [["-show_entries", "stream=index"], ["programs", "stream_groups", "streams"]],
    [["-show_streams", "-show_entries", "format=duration"], ["streams", "format"]],
    [["-show_entries", "stream_tags"], ["streams"]],
    [["-show_entries", "stream_disposition=default"], ["streams"]],
    [["-show_entries", "stream="], []],
    [["-show_programs"], ["programs"]],
    [["-show_programs", "-show_streams"], ["programs", "streams"]],
    [["-show_format"], ["format"]]
  ] satisfies [string[], string[]][]) {
    it(`matches native JSON sections for ${name}: ${selection.join(" ")}`, async () => {
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
        expect(Object.keys(parsed)).toEqual(keys);
        if (keys.includes("programs")) expect(parsed.programs).toEqual([]);
        if (keys.includes("stream_groups")) expect(parsed.stream_groups).toEqual([]);
        if (keys.includes("streams")) expect(parsed.streams.length).toBeGreaterThan(0);
        if (selection[1] === "stream=index")
          expect(parsed.streams).toEqual(parsed.streams.map((_: unknown, index: number) => ({ index })));
      }
    });
  }
}
