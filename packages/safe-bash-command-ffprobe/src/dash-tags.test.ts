import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createSyntheticMp4, parseMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

it("prints each DASH representation ID and bandwidth as selected stream tags", async () => {
  const fs = new MemoryFileSystem();
  const source = parseMp4(createSyntheticMp4({ width: 32, height: 24, frameCount: 2, includeAudio: true }));
  const video = source.tracks.find(track => track.type === "video")!;
  const audio = source.tracks.find(track => track.type === "audio")!;
  const representations = [
    { track: video, id: "main", bandwidth: "11176" },
    { track: video, id: "0", bandwidth: "4000" },
    { track: audio, id: "audio-fr", bandwidth: "32000" }
  ];
  for (const { track, id } of representations) {
    await fs.writeFile(`/${id}.mp4`, serializeMp4({ ...source, tracks: [track] }));
  }
  const xml = representations.map(({ id, bandwidth }) =>
    `<Representation id="${id}" bandwidth="${bandwidth}"><BaseURL>${id}.mp4</BaseURL></Representation>`);
  await fs.writeFile("/input.mpd", new TextEncoder().encode(
    `<MPD mediaPresentationDuration="PT1S"><Period><AdaptationSet>${xml.slice(0, 2).join("")}</AdaptationSet><AdaptationSet>${xml[2]}</AdaptationSet></Period></MPD>`
  ));
  let output = "", diagnostic = "";
  const result = await createFfprobeCommand().execute({
    command: "ffprobe", ...createCommandArguments([
      "-v", "error", "-show_entries", "stream=index,codec_type:stream_tags=id,variant_bitrate", "-of", "json", "/input.mpd"
    ]),
    cwd: "/", env: {}, fs, signal: new AbortController().signal,
    stdin: { async *[Symbol.asyncIterator]() {} },
    stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
    stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
  });
  expect(result.exitCode, diagnostic).toBe(0);
  expect(JSON.parse(output).streams).toEqual(representations.map(({ track, id, bandwidth }, index) => ({
    index, codec_type: track.type, tags: { id, variant_bitrate: bandwidth }
  })));
});
