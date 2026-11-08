import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { probeMp4Source } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native FFmpeg-generated AAC M4A with a 16x16 PNG in the covr metadata item.
const bytes = readFileSync(new URL("../../safe-bash-command-ffmpeg/src/fixtures/m4a-cover.m4a", import.meta.url));
for (const explicit of [false, true]) for (const selection of [[], ["-select_streams", "v"], ["-select_streams", "v:0"]]) {
  it(`reports MP4 cover artwork explicit=${explicit} with selection ${selection.join(" ") || "all"}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/art.m4a", bytes);
    const args = [...(explicit ? ["-f", "mp4"] : []), "-v", "error", "-show_streams", "-show_format", "-of", "json", ...selection, "/art.m4a"];
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    for (const text of [output, evalSyncFfprobe(undefined, args, () => bytes)!]) {
      const probe = JSON.parse(text);
      expect(probe.format.nb_streams).toBe(2);
      expect(probe.streams).toHaveLength(selection.length ? 1 : 2);
      if (!selection.length) expect(probe.streams[0]).toMatchObject({ codec_type: "audio", codec_name: "aac" });
      expect(probe.streams.at(-1)).toMatchObject({ index: 1, codec_type: "video", codec_name: "png", width: 16, height: 16, disposition: { attached_pic: 1 } });
    }
  });
}

it("reports cover artwork through the bounded MP4 source reader", async () => {
  const probe = await probeMp4Source({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } });
  const streams = [];
  for await (const stream of probe.streams) streams.push(stream);
  expect(probe.format.nb_streams).toBe(2);
  expect(streams).toHaveLength(2);
  expect(streams[1]).toMatchObject({ index: 1, codec_type: "video", codec_name: "png", width: 16, height: 16, disposition: { attached_pic: 1 } });
});

it("counts MP4 cover artwork toward stream limits", async () => {
  await expect(probeMp4Source({ size: bytes.length, async read(offset, length) { return bytes.subarray(offset, offset + length); } },
    { limits: { maxStreams: 1 } })).rejects.toThrow("maxStreams");
});
