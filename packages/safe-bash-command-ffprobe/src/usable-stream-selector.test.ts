import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { wavAst, type MediaProbeStream } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe, formatFfprobeResult } from "./media.js";

// Native ffprobe -select_streams u -show_entries stream=index -of json.
const fixtures = [
  { path: "../../mp4-ast/src/fixtures/attachments.mkv", inventory: [0, 1, 2, 3], usable: [0, 1, 2] },
  { path: "../../mp4-ast/src/fixtures/mdhd-language-german.mp4", inventory: [0, 1], usable: [0] },
  { path: "../../safe-bash-command-ffmpeg/src/fixtures/m4a-cover.m4a", inventory: [0, 1], usable: [0, 1] }
];

for (const { path, inventory, usable } of fixtures) {
  const bytes = readFileSync(new URL(path, import.meta.url));
  for (const route of ["file", "stdin", "sync"]) {
    for (const selected of [false, true]) {
      it(`${selected ? "selects usable streams from" : "preserves inventory for"} ${path} via ${route}`, async () => {
        const args = ["-v", "error", ...(selected ? ["-select_streams", "u"] : []),
          "-show_entries", "stream=index", "-of", "json", route === "stdin" ? "-" : "/input" + path.slice(path.lastIndexOf("."))];
        let output = "", diagnostic = "";
        if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes)!;
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile(args.at(-1) === "-" ? "/input" : args.at(-1)!, bytes);
          const result = await createFfprobeCommand().execute({
            command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: { async *[Symbol.asyncIterator]() { if (route === "stdin") yield bytes; } },
            stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
          });
          expect(result.exitCode, diagnostic).toBe(0);
          expect(diagnostic).toBe("");
        }
        expect(JSON.parse(output).streams).toEqual((selected ? usable : inventory).map(index => ({ index })));
      });
    }
  }
}

for (const [selector, indices] of [
  ["u", [0, 1, 2]], ["a:u", [0, 1]], ["a:a:u", [0, 1]], ["s:u", [2]], ["t:u", []]
] as const) {
  for (const route of ["file", "stdin", "sync"]) {
    for (const section of ["streams", "packets"]) {
      it(`selects ${selector} ${section} via ${route}`, async () => {
        const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/attachments.mkv", import.meta.url));
        const args = ["-v", "error", "-select_streams", selector, "-show_entries",
          section === "streams" ? "stream=index" : "packet=stream_index", "-of", "json",
          route === "stdin" ? "-" : "/input.mkv"];
        let output = "", diagnostic = "";
        if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes)!;
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile("/input.mkv", bytes);
          const result = await createFfprobeCommand().execute({
            command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: { async *[Symbol.asyncIterator]() { if (route === "stdin") yield bytes; } },
            stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
          });
          expect(result.exitCode, diagnostic).toBe(0);
          expect(diagnostic).toBe("");
        }
        const parsed = JSON.parse(output);
        if (section === "streams") expect(parsed.streams).toEqual(indices.map(index => ({ index })));
        else expect([...new Set(parsed.packets.map((packet: { stream_index: number }) => packet.stream_index))].sort())
          .toEqual(indices);
      });
    }
  }
}

const probe = wavAst().probe(encodeWav({ sampleRate: 8000, channels: [new Float64Array(8)] }), {});
// FFmpeg libavformat/avformat.c requires codec identity, plus audio rate/channels/
// sample format or video dimensions/pixel format. Other known codecs are usable.
it.each<{ name: string; fields: Partial<MediaProbeStream>; usable: boolean }>([
  { name: "configured audio", fields: {}, usable: true },
  { name: "missing codec", fields: { codec_name: undefined }, usable: false },
  { name: "unknown codec", fields: { codec_name: "unknown" }, usable: false },
  { name: "missing sample rate", fields: { sample_rate: undefined }, usable: false },
  { name: "zero sample rate", fields: { sample_rate: "0" }, usable: false },
  { name: "missing channels", fields: { channels: undefined }, usable: false },
  { name: "zero channels", fields: { channels: 0 }, usable: false },
  { name: "missing sample format", fields: { sample_fmt: undefined }, usable: false },
  { name: "unknown sample format", fields: { sample_fmt: "unknown" }, usable: false },
  { name: "configured video", fields: { codec_type: "video", codec_name: "h264", width: 16, height: 16, pix_fmt: "yuv420p" }, usable: true },
  { name: "missing width", fields: { codec_type: "video", height: 16, pix_fmt: "yuv420p" }, usable: false },
  { name: "zero width", fields: { codec_type: "video", width: 0, height: 16, pix_fmt: "yuv420p" }, usable: false },
  { name: "missing height", fields: { codec_type: "video", width: 16, pix_fmt: "yuv420p" }, usable: false },
  { name: "zero height", fields: { codec_type: "video", width: 16, height: 0, pix_fmt: "yuv420p" }, usable: false },
  { name: "missing pixel format", fields: { codec_type: "video", width: 16, height: 16 }, usable: false },
  { name: "unknown pixel format", fields: { codec_type: "video", width: 16, height: 16, pix_fmt: "unknown" }, usable: false },
  { name: "configured subtitle", fields: { codec_type: "subtitle", codec_name: "subrip" }, usable: true },
  { name: "configured attachment", fields: { codec_type: "attachment", codec_name: "ttf" }, usable: true },
  { name: "configured data", fields: { codec_type: "data", codec_name: "bin_data" }, usable: true }
])("checks $name for usability", ({ fields, usable }) => {
  const result = JSON.parse(formatFfprobeResult({ ...probe, streams: [{ ...probe.streams[0]!, ...fields }] }, {
    printFormat: "json", showStreams: true, showFormat: false, showPackets: false,
    showFrames: false, showChapters: false, showPrograms: false, selectStreams: "u", showEntries: "stream=index"
  }));
  expect(result.streams).toEqual(usable ? [{ index: 0 }] : []);
});
