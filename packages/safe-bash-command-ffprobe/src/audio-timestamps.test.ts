import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

const delayedMp3 = new Uint8Array(417 * 8);
for (let pos = 0; pos < delayedMp3.length; pos += 417) delayedMp3.set([255, 251, 144, 0], pos);
delayedMp3.set(new TextEncoder().encode("Xing"), 36);
new DataView(delayedMp3.buffer).setUint32(40, 1);
new DataView(delayedMp3.buffer).setUint32(44, 7);
delayedMp3.set(new TextEncoder().encode("Lavc63.1."), 48);
delayedMp3.set([0x24, 0x02, 0x40], 69); // 576 samples of encoder delay and padding.

// Expected values independently checked with native ffprobe.
const cases = [
  { name: "flac", bytes: readFileSync(new URL("./fixtures/unknown-duration.flac", import.meta.url)), timeBase: "1/8000", start: 0, time: "0.000000" },
  { name: "mp3", bytes: readFileSync(new URL("./fixtures/stdin.mp3", import.meta.url)), timeBase: "1/14112000", start: 0, time: "0.000000" },
  { name: "delayed.mp3", bytes: delayedMp3, timeBase: "1/14112000", start: 353600, time: "0.025057" },
  { name: "wav", bytes: encodeWav({ sampleRate: 8000, channels: [new Float64Array(2000)] }), timeBase: "1/8000", start: undefined, time: undefined }
];

for (const { name, bytes, timeBase, start, time } of cases) for (const file of [false, true]) for (const selected of [false, true]) {
  it(`reports ${name} timestamps via ${file ? "file" : "stdin"} in ${selected ? "selected" : "full"} output`, async () => {
    const filename = file ? `/input.${name}` : "-";
    const args = ["-v", "quiet", ...(selected
      ? ["-show_entries", "stream=time_base,start_pts,start_time:format=start_time"]
      : ["-show_streams", "-show_format"]), "-of", "json", "-i", filename];
    const fs = new MemoryFileSystem();
    if (file) await fs.writeFile(filename, bytes);
    let output = "", diagnostic = "";
    const result = await createFfprobeCommand().execute({
      command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() { if (!file) yield bytes; } },
      stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode, diagnostic).toBe(0);
    for (const text of [output, evalSyncFfprobe(file ? undefined : bytes, args, () => bytes)!]) {
      const probe = JSON.parse(text);
      expect(probe.streams[0].time_base).toBe(timeBase);
      expect(probe.streams[0].start_pts).toBe(start);
      expect(probe.streams[0].start_time).toBe(time);
      expect(probe.format.start_time).toBe(time);
      if (selected) {
        expect(probe.streams).toEqual([{ time_base: timeBase, ...(start === undefined ? {} : { start_pts: start, start_time: time }) }]);
        expect(probe.format).toEqual(time === undefined ? {} : { start_time: time });
      }
    }
  });
}
