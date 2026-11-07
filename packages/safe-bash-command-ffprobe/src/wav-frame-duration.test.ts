import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const samples of [16, 528]) {
  for (const target of ["/input.wav", "-"]) {
    it(`reports WAV frame durations for ${samples} samples through ${target}`, async () => {
      const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(samples)] });
      const args = ["-v", "error", "-of", "json", "-show_entries",
        "frame=pts_time,duration,duration_time,pkt_duration,pkt_duration_time,nb_samples,sample_fmt,channels", target];
      const expected = Array.from({ length: Math.ceil(samples / 512) }, (_, index) => {
        const count = Math.min(512, samples - index * 512);
        return { pts_time: (index * 512 / 8000).toFixed(6), duration: count,
          duration_time: (count / 8000).toFixed(6), pkt_duration: count,
          pkt_duration_time: (count / 8000).toFixed(6), nb_samples: count, sample_fmt: "s16", channels: 1 };
      });
      const fs = new MemoryFileSystem(); await fs.writeFile("/input.wav", bytes);
      let output = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { throw new Error(new TextDecoder().decode(chunk)); } }
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(output).frames).toEqual(expected);
      expect(JSON.parse(evalSyncFfprobe(target === "-" ? bytes : undefined, args, () => bytes)!).frames).toEqual(expected);
    });
  }
}
