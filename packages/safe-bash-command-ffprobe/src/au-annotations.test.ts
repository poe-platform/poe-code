import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

it("exposes native AU title and artist annotations as format tags", async () => {
  const annotation = Buffer.from("Title=Evening\nArtist=Kay\nComment=note\ncustom=solo\n\0");
  const header = Buffer.alloc(24);
  [0x2e736e64, 24 + annotation.length, 8, 3, 8000, 1]
    .forEach((value, index) => header.writeUInt32BE(value, index * 4));
  const input = Buffer.concat([header, annotation, Buffer.from("0064ff38012cfe70", "hex")]);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/tag.au", input);

  for (const entries of ["format_tags", "format_tags:stream=codec_name,sample_rate,channels,duration_ts"]) {
    const args = ["-v", "error", "-show_entries", entries, "-of", "json"];
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments([...args, "/tag.au"]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    const expected = {
      format: { tags: { title: "Evening", artist: "Kay" } },
      ...(entries.includes("stream=") ? {
        programs: [], stream_groups: [],
        streams: [{ codec_name: "pcm_s16be", sample_rate: "8000", channels: 1, duration_ts: 4 }]
      } : {})
    };
    expect(JSON.parse(output)).toEqual(expected);
    expect(JSON.parse(evalSyncFfprobe(input, [...args, "pipe:0"])!)).toEqual(expected);
  }
});

// Exact bytes from native FFmpeg 7.0.2, with title/artist/album/track/genre
// and unsupported date=2001, comment=Note, session="Room 4" metadata supplied.
const native = Buffer.from("LnNuZAAAAFAAAAAIAAAAAwAAH0AAAAABVGl0bGU9U29uZwpBcnRpc3Q9QWxpY2UKQWxidW09UmVjb3JkClRyYWNrPTIKR2VucmU9Rm9sawAAZP84ASz+cA==", "base64");

it("exposes all five native AU annotations through async and sync commands", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/native.au", native);
  const args = ["-v", "error", "-show_entries", "format_tags", "-of", "json"];
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments([...args, "-i", "/native.au"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: (async function* () {})(),
    stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes) { diagnostic += new TextDecoder().decode(bytes); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  const expected = { format: { tags: {
    title: "Song", artist: "Alice", album: "Record", track: "2", genre: "Folk"
  } } };
  expect(JSON.parse(output)).toEqual(expected);
  expect(JSON.parse(evalSyncFfprobe(native, [...args, "pipe:0"])!)).toEqual(expected);
});
