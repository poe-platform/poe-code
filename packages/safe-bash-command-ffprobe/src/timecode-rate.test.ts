import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { probeMp4, probeMp4Source } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe -v error -select_streams 1
//   -show_entries stream=r_frame_rate,avg_frame_rate -of json <fixture>
// Each unchanged native fixture has three H.264 frames and one timecode packet.
for (const [name, average] of [["tagged", "12800/512"], ["drop", "30000/1001"]] as const) {
  const bytes = new Uint8Array(readFileSync(new URL(`./fixtures/timecode-rate-${name}.mp4`, import.meta.url)));
  const rates = { r_frame_rate: "0/0", avg_frame_rate: average };

  it(`reads the declared ${name} timecode rate through resident and bounded source probes`, async () => {
    expect(probeMp4(bytes).streams[1]).toMatchObject(rates);
    const probe = await probeMp4Source({ size: bytes.length, async read(offset, length) {
      return bytes.subarray(offset, offset + length);
    } }, { syncSamples() {
      const keys = new Set<number>();
      return { add(key: number) { keys.add(key); }, has(key: number) { return keys.has(key); } };
    } });
    const streams = [];
    for await (const stream of probe.streams) streams.push(stream);
    expect(streams[1]).toMatchObject(rates);
  });

  for (const input of ["file", "stdin"] as const) {
    it(`reports the declared ${name} timecode rate through ffprobe using ${input}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.mp4", bytes);
      const args = ["-v", "error", "-select_streams", "1", "-show_entries",
        "stream=r_frame_rate,avg_frame_rate", "-of", "json", input === "file" ? "/in.mp4" : "pipe:0"];
      const expected = { programs: [], stream_groups: [], streams: [rates] };
      expect(JSON.parse(evalSyncFfprobe(bytes, args, () => bytes)!)).toEqual(expected);
      let output = "", diagnostic = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: (async function* () { if (input === "stdin") yield bytes; })(),
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, diagnostic).toBe(0);
      expect(diagnostic).toBe("");
      expect(JSON.parse(output)).toEqual(expected);
    });
  }
}
