import { expect, it } from "vitest";
import { flacAst, createSyntheticMp4, parseMp4 } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./media.js";

for (const route of ["file", "stdin"]) for (const countsOnly of [false, true]) {
  it(`reports FLAC packets and counts over ${route}, counts only=${countsOnly}`, async () => {
    const doc = parseMp4(createSyntheticMp4({ includeAudio: true, frameCount: 1 }));
    const track = doc.tracks.find(track => track.type === "audio")!;
    const bytes = flacAst().serialize({ ...doc, tracks: [{ ...track, decodedAudio: {
      sampleRate: 48000, channels: 1, channelData: [new Float32Array(4352)]
    } }] });
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.flac", bytes);
    let output = "", diagnostic = "";
    const args = ["-count_packets", "-count_frames", "-show_entries",
      `stream=nb_frames,nb_read_packets,nb_read_frames${countsOnly ? "" : ":packet=pts,duration,size"}`,
      "-of", "json", route === "stdin" ? "-" : "/input.flac"];
    const result = await createFfprobeCommand().execute({ command: "ffprobe", ...createCommandArguments(args),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { for (let offset = 0; offset < bytes.length; offset += 71) yield bytes.subarray(offset, offset + 71); } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    expect(JSON.parse(output)).toEqual({ programs: [], stream_groups: [], streams: [{ nb_read_packets: "3", nb_read_frames: "3" }],
      ...(countsOnly ? {} : { packets: [
        { pts: 0, duration: 2048, size: "4107" },
        { pts: 2048, duration: 2048, size: "4107" },
        { pts: 4096, duration: 256, size: "523" }
      ] }) });
  });
}
