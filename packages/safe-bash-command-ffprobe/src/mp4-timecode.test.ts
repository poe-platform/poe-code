import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { parseMp4, probeMp4, probeMp4Source } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

function syncSamples() {
  const samples = new Set<number>();
  return { add(sample: number) { samples.add(sample); }, has(sample: number) { return samples.has(sample); } };
}

// Native FFmpeg fixtures: three H.264 frames with normal and 30000/1001 drop-frame tmcd tracks.
for (const [name, timecode] of [["tagged", "01:02:03:04"], ["drop", "01:02:03;04"]] as const) {
  const bytes = new Uint8Array(readFileSync(new URL(`../../mp4-ast/src/fixtures/timecode-${name}.mp4`, import.meta.url)));
  it(`reads ${name} timecode through resident and bounded source probes`, async () => {
    expect(probeMp4(bytes).streams[1]?.tags?.timecode).toBe(timecode);
    const packet = parseMp4(bytes).tracks[1]!.samples[0]!;
    const payloadReads: number[] = [];
    const probe = await probeMp4Source({ size: bytes.length, async read(offset, length) {
      if (offset >= packet.offset! && offset < packet.offset! + packet.size) payloadReads.push(length);
      return bytes.subarray(offset, offset + length);
    } }, { syncSamples });
    const streams = [];
    for await (const stream of probe.streams) streams.push(stream);
    expect(streams[1]?.tags?.timecode).toBe(timecode);
    expect(payloadReads.length).toBeGreaterThan(0);
    expect(payloadReads.every(length => length === 4)).toBe(true);
  });

  for (const input of ["file", "stdin"] as const) {
    it(`reports ${name} timecode through public ffprobe using ${input}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.mp4", bytes);
      const args = ["-v", "error", "-select_streams", "1", "-show_entries", "stream_tags=timecode", "-of", "json", input === "file" ? "/in.mp4" : "pipe:0"];
      const expected = { streams: [{ tags: { timecode } }] };
      expect(JSON.parse(evalSyncFfprobe(bytes, [...args.slice(0, -1), "pipe:0"])!)).toEqual(expected);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: (async function* () { if (input === "stdin") yield bytes; })(),
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(JSON.parse(output)).toEqual(expected);
    });
  }
}

// Native ffprobe results for counter boundaries and sample-description flags.
it.each([
  [0, 1, 30000, 1001, 30, "00:00:00;00"],
  [1799, 1, 30000, 1001, 30, "00:00:59;29"],
  [1800, 1, 30000, 1001, 30, "00:01:00;02"],
  [17981, 1, 30000, 1001, 30, "00:09:59;29"],
  [17982, 1, 30000, 1001, 30, "00:10:00;00"],
  [2589408, 1, 30000, 1001, 30, "24:00:00;00"],
  [2589408, 3, 30000, 1001, 30, "00:00:00;00"],
  [0xffffffff, 1, 30000, 1001, 30, "00:00:00;01"],
  [0xffffffff, 5, 30000, 1001, 30, "-00:00:00;01"],
  [3600, 1, 60000, 1001, 30, "00:02:00;08"],
  [1800, 1, 30000, 1001, 29, "00:01:00;02"],
  [1800, 1, 25000, 1000, 25, undefined],
  [1800, 1, 0, 1001, 30, undefined],
  [1800, 1, 30000, 0, 30, undefined],
  [1800, 1, 30000, 1001, 0, undefined]
] as const)("decodes frame count %i with flags %i and rate %i/%i (%i frames)", async (count, flags, rate, duration, frames, expected) => {
  const bytes = readFileSync(new URL("../../mp4-ast/src/fixtures/timecode-drop.mp4", import.meta.url));
  const configuration = bytes.lastIndexOf("tmcd") + 12;
  const packet = parseMp4(bytes).tracks[1]!.samples[0]!;
  bytes.writeUInt32BE(count, packet.offset!);
  bytes.writeUInt32BE(flags, configuration + 4);
  bytes.writeUInt32BE(rate, configuration + 8);
  bytes.writeUInt32BE(duration, configuration + 12);
  bytes[configuration + 16] = frames;
  expect(probeMp4(bytes).streams[1]?.tags?.timecode).toBe(expected);
  const probe = await probeMp4Source({ size: bytes.length, async read(offset, length) {
    return bytes.subarray(offset, offset + length);
  } }, { syncSamples });
  const streams = [];
  for await (const stream of probe.streams) streams.push(stream);
  expect(streams[1]?.tags?.timecode).toBe(expected);
  expect(parseMp4(bytes).tracks[1]!.samples[0]!.data).toEqual(bytes.subarray(packet.offset!, packet.offset! + 4));
});
