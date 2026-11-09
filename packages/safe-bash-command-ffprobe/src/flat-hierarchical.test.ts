import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";
import { probe } from "./probe.js";
import { formatTaggedRows } from "./tag-format.js";

const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(80)] }, { tags: { title: 'a,b|c"d' } });
const writers = ["flat", "flat=h=0", "flat=hierarchical=0", "flat=h=1", "flat=hierarchical=1"];

for (const writer of writers) for (const explicit of [false, true]) for (const file of [false, true]) {
  for (const [entries, expected] of [
    ["packet=size", `${writer.endsWith("=0") ? "" : "packets."}packet.0.size="160"\n`],
    ["frame=nb_samples", `${writer.endsWith("=0") ? "" : "frames."}frame.0.nb_samples=80\n`],
    ["stream=index:format_tags=title", `${writer.endsWith("=0") ? "" : "streams."}stream.0.index=0\nformat.tags.title="a,b|c\\"d"\n`]
  ] as const) {
    it(`writes ${entries} with ${writer} through ${explicit ? "explicit media" : "automatic"} ${file ? "file" : "stdin"}`, async () => {
      const args = ["-v", "error", ...(explicit ? ["-f", "wav"] : []), "-of", writer, "-show_entries", entries, file ? "/input.wav" : "-"];
      const fs = new MemoryFileSystem();
      if (file) await fs.writeFile("/input.wav", bytes);
      let stdout = "", stderr = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (!file) yield bytes; } },
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, stderr).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toBe(expected);
      expect(evalSyncFfprobe(file ? undefined : bytes, args, () => bytes)).toBe(expected);
    });
  }
}

it.each(writers)("preserves audio field types and tag escaping with %s", writer => {
  // The audio formatter receives colon-separated writer settings.
  expect(probe(bytes, ["-of", writer.replace("=", ":"), "-show_entries", "stream=index:format_tags=title", "input.wav"]))
    .toBe(`${writer.endsWith("=0") ? "" : "streams."}stream.0.index=0\nformat.tags.title="a,b|c\\"d"\n`);
});

it.each(writers)("preserves streamed audio tags and stream indices with %s", async writer => {
  const tags = { count: 1, async *entries() {
    yield { key: "title", async *text() { yield 'a,b|c'; yield '"d'; } };
  } };
  async function* rows() {
    yield { section: "stream", row: { index: 0, tags: {} }, tags };
    yield { section: "stream", row: { index: 1, tags: {} }, tags };
  }
  let output = "";
  for await (const chunk of formatTaggedRows(rows(), ["-of", writer.replace("=", ":"), "-show_entries", "stream=index:stream_tags=title", "input.ogg"])) output += chunk;
  const prefix = writer.endsWith("=0") ? "" : "streams.";
  expect(output).toBe(`${prefix}stream.0.index=0\n${prefix}stream.0.tags.title="a,b|c\\"d"\n${prefix}stream.1.index=1\n${prefix}stream.1.tags.title="a,b|c\\"d"\n`);
});

it.each(writers)("preserves program and member indices with %s", writer => {
  const input = new Uint8Array(readFileSync(new URL("./fixtures/programs.mpegts", import.meta.url)));
  const output = evalSyncFfprobe(undefined, ["-show_entries", "program=program_id:stream=index", "-of", writer, "/input.ts"], () => input);
  const program = writer.endsWith("=0") ? "" : "programs.", stream = writer.endsWith("=0") ? "" : "streams.";
  expect(output).toBe(`${program}program.0.program_id=101\n${program}program.0.${stream}stream.0.index=0\n${program}program.1.program_id=202\n${program}program.1.${stream}stream.0.index=1\n${stream}stream.0.index=0\n${stream}stream.1.index=1\n`);
});
