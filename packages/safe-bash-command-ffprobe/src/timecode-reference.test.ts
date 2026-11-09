import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { parseMp4, probeMp4, serializeMp4 } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe: -v error -select_streams v -show_entries stream_tags=timecode -of json.
// Keep these H.264 fixtures unchanged; unlinked differs only in the tref type.
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/timecode-${name}.mp4`, import.meta.url)));
const linked = fixture("linked");
const doc = parseMp4(linked);
const video = doc.tracks[0]!, timecode = doc.tracks[1]!;
const invalidReference = (id: number) => {
  const bytes = Buffer.from(linked);
  bytes.writeUInt32BE(id, bytes.indexOf("tref") + 12);
  return bytes;
};
const multiple = serializeMp4({ ...doc, tracks: [
  { ...video, id: 10, timecodeTrackId: 42 },
  { ...video, id: 11, timecodeTrackId: undefined },
  { ...timecode, id: 99 },
  { ...timecode, id: 42, samples: [{ ...timecode.samples[0]!, data: Uint8Array.of(0, 0, 0, 25) }] }
] });

for (const [name, bytes, expected] of [
  ["linked", linked, ["01:02:03:04", "01:02:03:04"]],
  ["unlinked", fixture("unlinked"), [undefined, "01:02:03:04"]],
  ["video-only", fixture("video-only"), [undefined]],
  ["missing-target", invalidReference(999), [undefined, "01:02:03:04"]],
  ["non-timecode-target", invalidReference(video.id), [undefined, "01:02:03:04"]],
  ["fragmented", serializeMp4(doc, { fragmented: true }), ["01:02:03:04", "01:02:03:04"]],
  ["multiple", multiple, ["00:00:01:00", undefined, "01:02:03:04", "00:00:01:00"]]
] as const) {
  it(`reports referenced timecodes through resident probes (${name})`, () => {
    expect(probeMp4(bytes).streams.map(stream => stream.tags?.timecode)).toEqual(expected);
    const args = ["-v", "error", "-show_entries", "stream_tags=timecode", "-of", "json", "input.mp4"];
    const output = evalSyncFfprobe(bytes, args, () => bytes);
    expect(JSON.parse(output!).streams.map((stream: { tags?: { timecode?: string } }) => stream.tags?.timecode)).toEqual(expected);
  });

  for (const input of ["file", "stdin"] as const) for (const selection of [[], ["-select_streams", "v"]]) {
    it(`reports referenced timecodes through the direct command (${name}, ${input}, ${selection.join(" ")})`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/input.mp4", bytes);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(["-v", "error", ...selection,
          "-show_entries", "stream_tags=timecode", "-of", "json", input === "stdin" ? "pipe:0" : "input.mp4"]),
        cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (input === "stdin") yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(diagnostic).toBe("");
      expect(JSON.parse(output).streams.map((stream: { tags?: { timecode?: string } }) => stream.tags?.timecode))
        .toEqual(selection.length ? expected.slice(0, name === "multiple" ? 2 : 1) : expected);
    });
  }
}
