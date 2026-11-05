import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const inputs = {
  mp4: readFileSync(new URL("../../mp4-ast/src/fixtures/packet-positions-faststart.mp4", import.meta.url)),
  wav: encodeWav({ sampleRate: 8000, channels: [new Float64Array(100)] }, { tags: { title: "Example" } })
};

for (const [kind, bytes] of Object.entries(inputs)) {
  for (const mode of ["file", "stdin", "sync"]) {
    it.each([
      ["stream=", {}],
      ["format=", {}],
      ["stream_tags=", {}],
      ["format_tags=", {}],
      ["stream=index:stream_tags=", { streams: [{ index: 0 }] }],
      ["format=nb_streams:format_tags=", { format: { nb_streams: 1 } }],
      ["stream=:format=nb_streams", { format: { nb_streams: 1 } }]
    ] as const)(`honors empty entries for ${kind} via ${mode}: %s`, async (entries, expected) => {
      const args = ["-v", "error", "-show_entries", entries, "-of", "json", mode !== "file" ? "-" : `/input.${kind}`];
      let output = "", diagnostic = "";
      if (mode === "sync") output = evalSyncFfprobe(bytes, args)!;
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile(`/input.${kind}`, bytes);
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
}

it("keeps all stream tags when the field assignment is omitted", () => {
  const result = JSON.parse(evalSyncFfprobe(inputs.mp4, ["-show_entries", "stream=index:stream_tags", "-of", "json", "-"])!);
  expect(result.streams[0]).toMatchObject({ index: 0, tags: { language: "und", handler_name: "VideoHandler" } });
});

for (const section of ["packet", "frame", "chapter", "program"]) {
  it(`omits an explicitly empty ${section} section`, () => {
    expect(JSON.parse(evalSyncFfprobe(inputs.mp4, ["-show_entries", `${section}=`, "-of", "json", "-"])!)).toEqual({});
  });
}
