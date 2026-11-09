import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { mp4Ast, serializeMp4, webvttAst } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = new TextEncoder().encode("WEBVTT\n\na\n00:01.250 --> 00:02.750 align:start\nOne\nTwo\n\n00:04.000 --> 00:04.500\nThree\n");
const args = ["-v", "error", "-show_entries", "stream_disposition=default", "-of", "json"];
// Native ffprobe reports no default disposition for this standalone text stream.
const expected = { streams: [{ disposition: { default: 0 } }] };

it.each(["voices.vtt", "-"])("reports no default disposition for standalone WebVTT from %s", async target => {
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
  expect(JSON.parse(output)).toEqual(expected);
});

it("reports no standalone WebVTT default disposition through synchronous probing", () => {
  const output = evalSyncFfprobe(bytes, [...args, "voices.vtt"], () => bytes);
  expect(output).toBeDefined();
  expect(JSON.parse(output!)).toEqual(expected);
});

it("reports no standalone WebVTT default disposition through the media API", () => {
  expect(webvttAst().probe(bytes).streams[0]!.disposition.default).toBe(0);
});

it("preserves default disposition when WebVTT is muxed into MP4", () => {
  const mp4 = serializeMp4(webvttAst().parse(bytes));
  expect(mp4Ast().probe(mp4).streams[0]!.disposition.default).toBe(1);
  const output = evalSyncFfprobe(mp4, [...args, "voices.mp4"], () => mp4);
  expect(JSON.parse(output!)).toEqual({ streams: [{ disposition: { default: 1 } }] });
});
