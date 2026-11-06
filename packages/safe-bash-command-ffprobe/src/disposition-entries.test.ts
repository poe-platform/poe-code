import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/packet-positions-faststart.mp4", import.meta.url));

for (const fixture of ["h264-b-frames.mp4", "aac-external.mp4"]) {
  for (const selected of [false, true]) {
    it(`includes zero-valued newer dispositions for ${fixture} in ${selected ? "selected" : "ordinary"} output`, async () => {
      const disposition = { non_diegetic: 0, captions: 0, descriptions: 0, metadata: 0, dependent: 0, still_image: 0, multilayer: 0 };
      const fs = new MemoryFileSystem();
      await fs.writeFile("/clip.mp4", readFileSync(new URL(`../../mp4-ast/src/fixtures/${fixture}`, import.meta.url)));
      const args = ["-v", "error", ...(selected ? ["-show_entries", `stream_disposition=${Object.keys(disposition).join(",")}`] : ["-show_streams"]), "-of", "json", "/clip.mp4"];
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() {} },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      const streams = JSON.parse(output).streams;
      expect(streams).toHaveLength(fixture === "aac-external.mp4" ? 2 : 1);
      for (const stream of streams) {
        if (selected) expect(stream.disposition).toEqual(disposition);
        else expect(stream.disposition).toMatchObject(disposition);
      }
    });
  }
}

for (const mode of ["file", "stdin", "sync"]) {
  it.each([
    ["stream=index:stream_disposition=default", { programs: [], stream_groups: [], streams: [{ index: 0, disposition: { default: 1 } }] }],
    ["stream_disposition=default,forced", { programs: [], stream_groups: [], streams: [{ disposition: { default: 1, forced: 0 } }] }],
    ["stream_disposition=missing", { programs: [], stream_groups: [], streams: [{ disposition: {} }] }],
    ["stream_disposition=", {}],
    ["stream=index:stream_disposition=", { programs: [], stream_groups: [], streams: [{ index: 0 }] }],
    ["stream_disposition=default:stream_tags=language", { programs: [], stream_groups: [], streams: [{ disposition: { default: 1 }, tags: { language: "und" } }] }]
  ] as const)(`selects disposition entries via ${mode}: %s`, async (entries, expected) => {
    const args = ["-v", "error", "-show_entries", entries, "-of", "json", mode === "file" ? "/clip.mp4" : "-"];
    let output = "", diagnostic = "";
    if (mode === "sync") output = evalSyncFfprobe(bytes, args)!;
    else {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/clip.mp4", bytes);
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
    }
    expect(JSON.parse(output)).toEqual(expected);
  });
}

it("selects all existing dispositions without a field assignment", () => {
  const full = JSON.parse(evalSyncFfprobe(bytes, ["-show_streams", "-of", "json", "-"])!);
  const selected = JSON.parse(evalSyncFfprobe(bytes, ["-show_entries", "stream_disposition", "-of", "json", "-"])!);
  expect(selected).toEqual({ programs: [], stream_groups: [], streams: [{ disposition: full.streams[0].disposition }] });
  expect(selected.streams[0].disposition).toMatchObject({ default: 1, forced: 0 });
});

it.each([
  ["compact", "stream|index=0|disposition:default=1\n"],
  ["csv", "stream,0,1\n"],
  ["flat", "streams.stream.0.index=0\nstreams.stream.0.disposition.default=1\n"],
  ["default", "[STREAM]\nindex=0\nDISPOSITION:default=1\n[/STREAM]\n"]
])("prints selected dispositions with the %s writer", (writer, expected) => {
  expect(evalSyncFfprobe(bytes, ["-show_entries", "stream=index:stream_disposition=default", "-of", writer, "-"])).toBe(expected);
});
