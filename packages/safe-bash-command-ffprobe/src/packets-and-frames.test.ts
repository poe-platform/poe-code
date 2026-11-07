import { expect, it } from "vitest";
import { encodeWav } from "@poe-code/audio-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const samples of [16, 528]) for (const target of ["/input.wav", "-"]) {
  for (const entries of ["packet=size:frame=nb_samples", "packet=size", "frame=nb_samples"]) {
    it(`matches native JSON for ${samples} samples, ${target}, ${entries}`, async () => {
      const bytes = encodeWav({ sampleRate: 8000, channels: [new Float64Array(samples)] });
      const args = ["-v", "error", "-of", "json", "-show_entries", entries, target];
      const counts = samples === 16 ? [16] : [512, 16];
      const expected = entries.includes(":")
        ? { packets_and_frames: counts.flatMap(nb_samples => [
          { type: "packet", size: String(nb_samples * 2) }, { type: "frame", nb_samples }
        ]) }
        : entries.startsWith("packet") ? { packets: counts.map(count => ({ size: String(count * 2) })) }
        : { frames: counts.map(nb_samples => ({ nb_samples })) };
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
      expect(JSON.parse(output)).toEqual(expected);
      expect(JSON.parse(evalSyncFfprobe(target === "-" ? bytes : undefined, args, () => bytes)!)).toEqual(expected);
    });
  }
}
