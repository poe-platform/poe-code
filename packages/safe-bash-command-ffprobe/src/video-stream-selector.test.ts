import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { probeMp4 } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe, formatFfprobeResult, formatFfprobeSourceChunks } from "./media.js";

const artwork = readFileSync(new URL("../../safe-bash-command-ffmpeg/src/fixtures/m4a-cover.m4a", import.meta.url));
const video = readFileSync(new URL("../../mp4-ast/src/fixtures/mdhd-language-german.mp4", import.meta.url));

// Native ffprobe selects the cover with v/v:0, but only real video with V/V:0.
for (const [name, bytes, videoIndex] of [["artwork", artwork, 1], ["video", video, 0]] as const) {
  for (const selector of ["v", "v:0", "v:1", "V", "V:0", "V:1"]) {
    for (const stdin of [false, true]) {
      it(`selects ${selector} from ${name}, stdin=${stdin}`, async () => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input.mp4", bytes);
        const args = ["-v", "error", "-select_streams", selector, "-show_entries", "stream=index", "-of", "json", stdin ? "-" : "/input.mp4"];
        let output = "", diagnostic = "";
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { if (stdin) yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
        expect(diagnostic).toBe("");
        const expected = selector.endsWith(":1") || name === "artwork" && selector.startsWith("V") ? [] : [{ index: videoIndex }];
        expect(JSON.parse(output).streams).toEqual(expected);
        expect(JSON.parse(evalSyncFfprobe(stdin ? bytes : undefined, args, () => bytes)!).streams).toEqual(expected);
      });
    }
  }
}

const probe = probeMp4(video, { showPackets: true, showFrames: true });
const streams = [
  { ...probe.streams[0]!, index: 0, disposition: { attached_pic: 1 } },
  { ...probe.streams[0]!, index: 1, disposition: { timed_thumbnails: 1 } },
  { ...probe.streams[0]!, index: 2 },
  { ...probe.streams[0]!, index: 3 },
];
const mixed = { ...probe, streams,
  packets: streams.flatMap(stream => probe.packets!.map(packet => ({ ...packet, stream_index: stream.index }))),
  frames: streams.flatMap(stream => probe.frames!.map(frame => ({ ...frame, stream_index: stream.index }))),
};
const options = { printFormat: "json", showFormat: false, showStreams: true, showPackets: true, showFrames: true, showChapters: false, showPrograms: false };
async function* rows<T>(values: Iterable<T>) { yield* values; }

it.each([
  ["v", [0, 1, 2, 3]], ["v:0", [0]], ["v:1", [1]],
  ["V", [2, 3]], ["V:0", [2]], ["V:1", [3]], ["V:2", []],
] as const)("filters streams, packets and frames with case-sensitive ordinal %s", async (selector, indices) => {
  const selected = new Set<number>(indices);
  const expected = formatFfprobeResult({ ...mixed,
    streams: mixed.streams.filter(stream => selected.has(stream.index)),
    packets: mixed.packets.filter(packet => selected.has(packet.stream_index)),
    frames: mixed.frames.filter(frame => selected.has(frame.stream_index)),
  }, options);
  expect(formatFfprobeResult(mixed, { ...options, selectStreams: selector })).toBe(expected);
  let output = "";
  for await (const chunk of formatFfprobeSourceChunks({ ...mixed, streams: rows(mixed.streams), packets: rows(mixed.packets), frames: rows(mixed.frames) }, { ...options, selectStreams: selector })) output += chunk;
  expect(output).toBe(expected);
});

for (const [name, bytes] of [["artwork", artwork], ["video", video]] as const) {
  it.each(["V", "V:0", "V:1"])(`reads selected video intervals from ${name} with %s`, async selector => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.mp4", bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(["-v", "error", "-select_streams", selector,
        "-read_intervals", "%+#1", "-count_packets", "-show_entries", "stream=index,nb_read_packets:packet=stream_index",
        "-of", "json", "/input.mp4"]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    const selected = name === "video" && selector !== "V:1";
    expect(JSON.parse(output).streams).toEqual(selected ? [{ index: 0, nb_read_packets: "1" }] : []);
    expect(JSON.parse(output).packets).toEqual(selected ? [{ stream_index: 0 }] : []);
  });
}
