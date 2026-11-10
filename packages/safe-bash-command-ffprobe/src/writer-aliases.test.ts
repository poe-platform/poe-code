import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";
import { probe } from "./probe.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(16)] });
const cases = [
  ["flat=s=_:sep_char=-", "streams-stream-0-index=0\n"],
  ["flat=sep_char=-:s=_", "streams_stream_0_index=0\n"],
  ["flat=h=0:hierarchical=1", "streams.stream.0.index=0\n"],
  ["flat=hierarchical=1:h=0", "stream.0.index=0\n"],
  ["compact=p=0:print_section=1", "stream|index=0\n"],
  ["compact=print_section=1:p=0", "index=0\n"],
  ["compact=nk=1:nokey=0", "stream|index=0\n"],
  ["compact=nokey=0:nk=1", "stream|0\n"],
  ["compact=s=,:item_sep=|", "stream|index=0\n"],
  ["compact=item_sep=|:s=,", "stream,index=0\n"],
  ["compact=p=0:print_section=1:p=0", "index=0\n"],
  ["csv=p=0:print_section=1", "stream,0\n"],
  ["csv=print_section=1:p=0", "0\n"],
  ["csv=nk=1:nokey=0", "stream,index=0\n"],
  ["csv=nokey=0:nk=1", "stream,0\n"],
  ["csv=s=,:item_sep=|", "stream|0\n"],
  ["csv=item_sep=|:s=,", "stream,0\n"],
  ["default=nw=1:noprint_wrappers=0", "[STREAM]\nindex=0\n[/STREAM]\n"],
  ["default=noprint_wrappers=0:nw=1", "index=0\n"],
  ["default=nk=1:nokey=0", "[STREAM]\nindex=0\n[/STREAM]\n"],
  ["default=nokey=0:nk=1", "[STREAM]\n0\n[/STREAM]\n"],
  ["ini=h=0:hierarchical=1", "# ffprobe output\n\n\n\n[streams.stream.0]\nindex=0\n"],
  ["ini=hierarchical=1:h=0", "# ffprobe output\n\n\n\n[stream.0]\nindex=0\n"]
] as const;

it.each(cases)("applies writer aliases in order: %s", async (writer, expected) => {
  const args = ["-v", "error", "-of", writer, "-show_entries", "stream=index", "/input.wav"];
  const fs = new MemoryFileSystem();
  await fs.writeFile("/input.wav", bytes);
  let stdout = "", stderr = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
    signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(stdout).toBe(expected);
  expect(evalSyncFfprobe(bytes, args, () => bytes)).toBe(expected);
  expect(probe(bytes, args.map(arg => arg === writer ? writer.replace("=", ":") : arg))).toBe(expected);
});

it.each([
  ["json=c=1:compact=0", '{\n    "programs": [\n\n    ],\n    "stream_groups": [\n\n    ],\n    "streams": [\n        {\n            "index": 0\n        }\n    ]\n}\n'],
  ["json=compact=0:c=1", '{\n    "programs": [\n\n    ],\n    "stream_groups": [\n\n    ],\n    "streams": [\n        { "index": 0 }\n    ]\n}\n']
])("applies JSON aliases in order: %s", (writer, expected) => {
  expect(evalSyncFfprobe(bytes, ["-of", writer, "-show_entries", "stream=index", "-"])).toBe(expected);
});

it.each([
  ["compact=e=c:escape=none", "format|filename=a|b.wav\n"],
  ["compact=escape=none:e=c", "format|filename=a\\|b.wav\n"]
])("applies escape aliases in order: %s", (writer, expected) => {
  const args = ["-of", writer, "-show_entries", "format=filename", "a|b.wav"];
  expect(evalSyncFfprobe(bytes, args, () => bytes)).toBe(expected);
  expect(probe(bytes, args.map(arg => arg === writer ? writer.replace("=", ":") : arg))).toBe(expected);
});
