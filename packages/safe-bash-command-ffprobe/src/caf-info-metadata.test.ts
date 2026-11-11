import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

it("exposes native CAF standard and custom info entries as format tags", async () => {
  // Native FFmpeg 7.0.2: s16le 8000 Hz mono input, pcm_s16be CAF with the tags below.
  const bytes = Buffer.from(
    "636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000020000000100000001000000106368616e000000000000000c006400010000000000000000696e666f0000000000000077000000097469746c6500536f6e670061727469737400416c69636500616c62756d005265636f726400747261636b00320067656e726500466f6c6b0064617465003230303100636f6d6d656e74004e6f74650073657373696f6e00526f6f6d203400656e636f646572004c61766636312e312e3130300064617461000000000000000c000000000064ff38012cfe70", "hex");
  const args = ["-v", "error", "-show_entries", "format_tags", "-of", "json", "/in.caf"];
  const expected = { format: { tags: {
    title: "Song", artist: "Alice", album: "Record", track: "2", genre: "Folk",
    date: "2001", comment: "Note", session: "Room 4", encoder: "Lavf61.1.100"
  } } };
  expect(JSON.parse(evalSyncFfprobe(bytes, [...args.slice(0, -1), "pipe:0"])!)).toEqual(expected);

  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.caf", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  expect(JSON.parse(output)).toEqual(expected);
  expect(await fs.readFile("/in.caf")).toEqual(new Uint8Array(bytes));
});
