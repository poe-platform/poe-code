import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { mp4Ast, serializeMp4, webvttAst } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const bytes = new TextEncoder().encode("WEBVTT\n\na\n00:01.250 --> 00:02.750 align:start\nOne\nTwo\n\n00:04.000 --> 00:04.500\nThree\n");
const args = ["-v", "error", "-show_entries", "stream=index,id", "-of", "json"];

it.each(["voices.vtt", "-"])("omits the synthetic stream ID for standalone WebVTT from %s", async target => {
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
  expect(JSON.parse(output).streams).toEqual([{ index: 0 }]);
});

it("omits the standalone WebVTT stream ID through synchronous probing", () => {
  const output = evalSyncFfprobe(bytes, [...args, "voices.vtt"], () => bytes);
  expect(output).toBeDefined();
  expect(JSON.parse(output!).streams).toEqual([{ index: 0 }]);
});

it("keeps cue identifiers separate from stream IDs through the media API", () => {
  const plugin = webvttAst();
  expect(plugin.parse(bytes).tracks[0]!.samples[0]!.webvtt?.identifier).toBe("a");
  expect(plugin.probe(bytes).streams[0]!.id).toBeUndefined();
});

it("preserves declared stream IDs when WebVTT is muxed into MP4", () => {
  const doc = webvttAst().parse(bytes);
  const mp4 = serializeMp4({ ...doc, tracks: [{ ...doc.tracks[0]!, id: 7 }] });
  expect(mp4Ast().probe(mp4).streams[0]).toMatchObject({ index: 0, id: "0x7" });
  const output = evalSyncFfprobe(mp4, [...args, "voices.mp4"], () => mp4);
  expect(JSON.parse(output!).streams).toEqual([{ index: 0, id: "0x7" }]);
});
