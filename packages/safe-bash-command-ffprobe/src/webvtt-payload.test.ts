import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const voices = "WEBVTT\n\na\n00:01.250 --> 00:02.750 align:start\nOne\nTwo\n\n00:04.000 --> 00:04.500\nThree\n";
const dumps = ["\n00000000: 4f6e 650a 5477 6f                        One.Two\n", "\n00000000: 5468 7265 65                             Three\n"];

for (const route of ["file", "stdin", "explicit", "sync", "interval"]) {
  for (const mode of ["plain", "data", "hash", "both", "size"]) {
    it(`reports WebVTT caption ${mode} through ${route}`, async () => {
      const bytes = new TextEncoder().encode(voices);
      const showData = mode === "data" || mode === "both" || mode === "size";
      const showHash = mode === "hash" || mode === "both" || mode === "size";
      const args = ["-v", "error", "-of", "json", "-show_packets",
        ...(showData ? ["-show_data"] : []), ...(showHash ? ["-show_data_hash", "sha256"] : []),
        ...(mode === "size" ? ["-show_entries", "packet=size"] : []),
        ...(route === "explicit" ? ["-f", "webvtt"] : []),
        ...(route === "interval" ? ["-read_intervals", "4%+#1"] : []),
        route === "stdin" ? "-" : "/voices.vtt"];
      let output = "", error = "";
      if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/voices.vtt", bytes);
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { error += new TextDecoder().decode(chunk); } }
        });
        expect(error).toBe("");
        expect(result.exitCode).toBe(0);
      }
      const packets = ["One\nTwo", "Three"].map((caption, index) => ({
        codec_type: "subtitle", stream_index: 0,
        pts: index === 0 ? 1250 : 4000, pts_time: index === 0 ? "1.250000" : "4.000000",
        dts: index === 0 ? 1250 : 4000, dts_time: index === 0 ? "1.250000" : "4.000000",
        duration: index === 0 ? 1500 : 500, duration_time: index === 0 ? "1.500000" : "0.500000",
        size: String(caption.length), flags: "K__",
        ...(showData ? { data: dumps[index] } : {}),
        ...(showHash ? { data_hash: `SHA256:${createHash("sha256").update(caption).digest("hex")}` } : {})
      }));
      const selected = route === "interval" ? packets.slice(1) : packets;
      const actual = JSON.parse(output).packets;
      expect(actual).toHaveLength(selected.length);
      if (mode === "size") {
        expect(actual.map((packet: { size: string }) => ({ size: packet.size }))).toEqual(selected.map(({ size }) => ({ size })));
        for (const packet of actual) {
          expect(packet).not.toHaveProperty("data");
          expect(packet).not.toHaveProperty("data_hash");
        }
      }
      else {
        for (const [index, packet] of actual.entries()) {
          expect(packet).toMatchObject(selected[index]!);
          if (!showData) expect(packet).not.toHaveProperty("data");
          if (!showHash) expect(packet).not.toHaveProperty("data_hash");
        }
      }
    });
  }
}

for (const [name, input, captions] of [
  ["CRLF and BOM", "\uFEFF" + voices.replaceAll("\n", "\r\n"), ["One\nTwo", "Three"]],
  ["sorted Unicode and literal markup", "WEBVTT\n\n00:04.000 --> 00:05.000\n é &amp; <v Jo>猫</v> \n\n00:01.000 --> 00:02.000\nFirst\n", ["First", " é &amp; <v Jo>猫</v> "]],
  ["empty caption before text", "WEBVTT\n\n00:01.000 --> 00:02.000\n\n00:03.000 --> 00:04.000\nNext\n", ["", "Next"]],
  ["no cues", "WEBVTT\n", []]
] as const) {
  it(`hashes exact demuxed bytes for ${name}`, () => {
    const bytes = new TextEncoder().encode(input);
    const output = evalSyncFfprobe(undefined, ["-of", "json", "-show_data_hash", "sha256", "-show_entries", "packet=size,data_hash", "/voices.vtt"], () => bytes);
    const packets = JSON.parse(output!).packets;
    expect(packets).toHaveLength(captions.length);
    for (const [index, caption] of captions.entries()) {
      expect(packets[index]).toMatchObject({ size: String(new TextEncoder().encode(caption).length),
        data_hash: `SHA256:${createHash("sha256").update(caption).digest("hex")}` });
    }
  });
}
