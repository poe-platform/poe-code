import { expect, it } from "vitest";
import { auAst } from "@poe-code/mp4-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Native ffprobe omits nb_frames: AU declares bytes, not a frame count.
// At 8 kHz, stereo PCM16 is read in packets of at most 320 samples.
for (const samples of [97, 5001]) {
  const bytes = Buffer.alloc(32 + samples * 4);
  [0x2e736e64, 32, samples * 4, 3, 8000, 2].forEach((value, index) => bytes.writeUInt32BE(value, index * 4));
  const records = String(Math.ceil(samples / 320));

  it(`keeps AU read counts separate from declared counts in the SDK for ${samples} samples`, () => {
    const stream = auAst().probe(bytes).streams[0]!;
    expect(stream.nb_frames).toBeUndefined();
    expect(stream).toMatchObject({ duration_ts: samples, nb_read_frames: records, nb_read_packets: records });
  });

  for (const route of ["file", "stdin", "explicit", "sync"]) {
    for (const count of [false, true]) {
      it(`omits AU nb_frames for ${samples} samples through ${route}, count=${count}`, async () => {
        const args = ["-v", "error", ...(count ? ["-count_frames", "-count_packets"] : []),
          "-show_entries", "stream=nb_frames,nb_read_frames,nb_read_packets,duration_ts", "-of", "json",
          ...(route === "explicit" ? ["-f", "au"] : []), route === "stdin" ? "-" : "/input.au"];
        let output = "", diagnostic = "";
        if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile("/input.au", bytes);
          const result = await createFfprobeCommand().execute({
            command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
            stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
            stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
          });
          expect(result.exitCode, diagnostic).toBe(0);
          expect(diagnostic).toBe("");
        }
        expect(JSON.parse(output).streams).toEqual([{
          duration_ts: samples,
          ...(count ? { nb_read_frames: records, nb_read_packets: records } : {})
        }]);
      });
    }
  }
}
