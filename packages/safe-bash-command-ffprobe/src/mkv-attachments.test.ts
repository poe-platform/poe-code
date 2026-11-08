import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

// Native FFmpeg fixture; attachment fields checked against native ffprobe.
const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/attachments.mkv", import.meta.url));
for (const route of ["file", "stdin"]) it(`includes Matroska attachments without packets via ${route}`, async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/tracks.mkv", bytes);
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments(["-v", "error", "-of", "json", "-show_streams", "-show_format", "-show_packets", route === "stdin" ? "-" : "/tracks.mkv"]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  const probe = JSON.parse(output);
  expect(probe.format.nb_streams).toBe(4);
  expect(probe.streams.map((stream: { codec_type: string }) => stream.codec_type)).toEqual(["audio", "audio", "subtitle", "attachment"]);
  expect(probe.streams[3]).toMatchObject({ index: 3, extradata_size: 13, tags: { filename: "guide.txt", mimetype: "text/plain" } });
  expect(probe.streams[3]).not.toHaveProperty("codec_name");
  expect(probe.packets.length).toBeGreaterThan(0);
  expect(probe.packets.every((packet: { stream_index: number }) => packet.stream_index < 3)).toBe(true);
});
