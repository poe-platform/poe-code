import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";
import { probe } from "./probe.js";
import { formatTaggedRows } from "./tag-format.js";

const bytes = Uint8Array.from(Buffer.from(
  "524946464c00000057415645666d74201000000001000100401f0000803e0000020010004c49535410000000494e464f494e414d0400000041094200646174611000000000000000000000000000000000000000",
  "hex"
));
const writers = [["flat", "."], ["flat=h=0", "."], ["flat=s=_", "_"]] as const;

for (const [writer, separator] of writers) {
  const expected = `format${separator}tags${separator}title="A\tB"\n`;
  for (const explicit of [false, true]) for (const file of [false, true]) {
    it(`preserves literal tab bytes with ${writer} through ${explicit ? "media" : "audio"} ${file ? "file" : "stdin"}`, async () => {
      const fs = new MemoryFileSystem();
      if (file) await fs.writeFile("/tab.wav", bytes);
      const args = ["-v", "error", ...(explicit ? ["-f", "wav"] : []), "-of", writer,
        "-show_entries", "format_tags=title", file ? "/tab.wav" : "-"];
      let stdout = "", stderr = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (!file) yield bytes; } },
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect({ exitCode: result.exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
      expect(evalSyncFfprobe(file ? undefined : bytes, args, () => bytes)).toBe(expected);
    });
  }

  it(`preserves tabs in buffered audio with ${writer}`, () => {
    expect(probe(bytes, ["-of", writer.replace("=", ":"), "-show_entries", "format_tags=title", "/tab.wav"]))
      .toBe(expected);
  });
}

it.each(["flat", "json"])("preserves %s escaping for tabs, backslashes, quotes and line endings", async writer => {
  const title = 'A\tB\\t"C\nD\rE';
  const input = encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }, { tags: { title } });
  const args = ["-of", writer, "-show_entries", "format_tags=title", "/input.wav"];
  const expected = writer === "flat" ? 'format.tags.title="A\tB\\\\t\\"C\\nD\\rE"\n'
    : JSON.stringify({ format: { tags: { title } } }, null, 4) + "\n";
  expect(probe(input, args)).toBe(expected);

  const tags = { count: 1, async *entries() {
    yield { key: "title", async *text() { yield* title; } };
  } };
  async function* rows() { yield { section: "format", row: { tags: {} }, tags }; }
  let output = "";
  for await (const chunk of formatTaggedRows(rows(), args)) output += chunk;
  expect(output).toBe(expected);
});
