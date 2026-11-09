import { expect, it } from "vitest";
import { webvttAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Unchanged voices.vtt: native ffprobe learns the stream start when reading cues.
const bytes = new TextEncoder().encode("WEBVTT\n\na\n00:01.250 --> 00:02.750 align:start\nOne\nTwo\n\n00:04.000 --> 00:04.500\nThree\n");
const timing = { start_pts: 1250, start_time: "1.250000" };

for (const mode of [undefined, "-show_packets", "-show_frames", "-count_packets", "-count_frames"]) {
  for (const target of ["/voices.vtt", "-"]) {
    it(`reports WebVTT start only after reading cues: ${mode ?? "metadata"}, ${target}`, async () => {
      const args = ["-v", "error", ...(mode ? [mode] : []), "-show_entries",
        "stream=start_pts,start_time", "-of", "json", target];
      const fs = new MemoryFileSystem();
      await fs.writeFile("/voices.vtt", bytes);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { if (target === "-") yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(diagnostic).toBe("");
      const expected = [mode ? timing : {}];
      const parsed = JSON.parse(output);
      expect(parsed.streams).toEqual(expected);
      if (mode === "-show_packets") {
        expect(parsed.packets.map((packet: { pts: number; duration: number }) => [packet.pts, packet.duration]))
          .toEqual([[1250, 1500], [4000, 500]]);
      }
      expect(JSON.parse(evalSyncFfprobe(bytes, args, () => bytes)!).streams).toEqual(expected);
    });
  }
}

it("preserves known WebVTT timing in the media API", () => {
  for (const options of [{}, { showPackets: true }, { showFrames: true }]) {
    const stream = webvttAst().probe(bytes, options).streams[0]!;
    expect({ start_pts: stream.start_pts, start_time: stream.start_time }).toEqual(
      options.showPackets || options.showFrames ? timing : { start_pts: undefined, start_time: undefined }
    );
  }
});

it("uses optional-field placeholders for unknown WebVTT start timestamps", () => {
  const output = evalSyncFfprobe(bytes, ["-show_entries", "stream=start_pts,start_time",
    "-show_optional_fields", "always", "-of", "json", "-"]);
  expect(JSON.parse(output!).streams).toEqual([{ start_pts: "N/A", start_time: "N/A" }]);
});

it("leaves an empty WebVTT stream start unknown even when reading packets", () => {
  const stream = webvttAst().probe(new TextEncoder().encode("WEBVTT\n\n"), { showPackets: true }).streams[0]!;
  expect(stream.start_pts).toBeUndefined();
  expect(stream.start_time).toBeUndefined();
});
