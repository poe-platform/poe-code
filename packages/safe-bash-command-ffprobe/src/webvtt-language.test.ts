import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { mp4Ast, serializeMp4, webvttAst } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = new TextEncoder().encode("WEBVTT\n\na\n00:01.250 --> 00:02.750 align:start\nOne\nTwo\n\n00:04.000 --> 00:04.500\nThree\n");
const args = ["-v", "error", "-show_entries", "stream_tags=language", "-of", "json"];

it.each([
  ["voices.vtt", []],
  ["-", []],
  ["voices.vtt", ["-f", "webvtt"]]
] as const)("omits undeclared WebVTT language from %s with %j", async (target, inputOptions) => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/voices.vtt", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments([...args, ...inputOptions, target]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { if (target === "-") yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  expect(diagnostic).toBe("");
  expect(JSON.parse(output)).toEqual({ streams: [{}] });
});

it("omits undeclared WebVTT language through synchronous probing", () => {
  const output = evalSyncFfprobe(bytes, [...args, "voices.vtt"], () => bytes);
  expect(output).toBeDefined();
  expect(JSON.parse(output!)).toEqual({ streams: [{}] });
});

it("omits undeclared WebVTT language from full stream tags", () => {
  expect(webvttAst().probe(bytes).streams[0]!.tags).toBeUndefined();
});

it.each(["und", "eng"])("preserves MP4 WebVTT language %s", language => {
  const doc = webvttAst().parse(bytes);
  const mp4 = serializeMp4({ ...doc, tracks: [{ ...doc.tracks[0]!, language }] });
  expect(mp4Ast().probe(mp4).streams[0]!.tags).toMatchObject({ language });
  const output = evalSyncFfprobe(mp4, [...args, "voices.mp4"], () => mp4);
  expect(JSON.parse(output!)).toEqual({ streams: [{ tags: { language } }] });
});
