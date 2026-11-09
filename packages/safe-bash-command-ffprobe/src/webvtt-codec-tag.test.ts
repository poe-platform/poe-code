import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { webvttAst } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = new TextEncoder().encode("WEBVTT\n\na\n00:01.250 --> 00:02.750 align:start\nOne\nTwo\n\n00:04.000 --> 00:04.500\nThree\n");
const args = ["-v", "error", "-show_entries", "stream=codec_name,codec_tag,codec_tag_string", "-of", "json"];
// Native ffprobe reports no container tag for this standalone text stream.
const expected = { codec_name: "webvtt", codec_tag_string: "[0][0][0][0]", codec_tag: "0x0000" };

it.each(["voices.vtt", "-"])("reports no container codec tag for standalone WebVTT from %s", async target => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/voices.vtt", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments([...args, target]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { if (target === "-") yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  expect(diagnostic).toBe("");
  expect(JSON.parse(output).streams).toEqual([expected]);
});

it("reports no standalone WebVTT codec tag through the synchronous command", () => {
  const output = evalSyncFfprobe(bytes, [...args, "voices.vtt"], () => bytes);
  expect(output).toBeDefined();
  expect(JSON.parse(output!).streams).toEqual([expected]);
});

it("reports no standalone WebVTT codec tag through the media API", () => {
  expect(webvttAst().probe(bytes).streams[0]).toMatchObject(expected);
});
