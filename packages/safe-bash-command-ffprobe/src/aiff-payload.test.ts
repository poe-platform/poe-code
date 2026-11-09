import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Five PCM16BE samples after seven SSND offset bytes, plus an odd-chunk pad.
const bytes = Buffer.from("464f524d0000004041494646434f4d4d000000120001000000050010400bfa0000000000000053534e4400000019000000070000001000010203040506000bff2b0bb80001fff700", "hex");
const data = "\n00000000: 000b ff2b 0bb8 0001 fff7                 ...+......\n";
const dataHash = "SHA256:98cf62eba8b7bf737cbb997b84f0948c3309bf1831b4b6b5521963fd71f1f4f3";

for (const route of ["file", "stdin", "explicit", "sync"]) {
  for (const mode of ["plain", "data", "hash", "both", "size"]) {
    it(`reports AIFF packet ${mode} without SSND padding through ${route}`, async () => {
      const showData = mode === "data" || mode === "both" || mode === "size";
      const showHash = mode === "hash" || mode === "both" || mode === "size";
      const args = ["-v", "error", "-of", "json",
        ...(showData ? ["-show_data"] : []), ...(showHash ? ["-show_data_hash", "sha256"] : []),
        ...(mode === "hash" ? ["-show_entries", "packet=data_hash"]
          : mode === "size" ? ["-show_entries", "packet=size"] : ["-show_packets"]),
        ...(route === "explicit" ? ["-f", "aiff"] : []), route === "stdin" ? "-" : "/offset.aiff"];
      let output = "", error = "";
      if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes) ?? "";
      else {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/offset.aiff", bytes);
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
      expect(JSON.parse(output)).toEqual({ packets: [mode === "hash" ? { data_hash: dataHash }
        : mode === "size" ? { size: "10" } : {
          codec_type: "audio", stream_index: 0, pts: 0, pts_time: "0.000000",
          dts: 0, dts_time: "0.000000", duration: 5, duration_time: "0.000625",
          size: "10", pos: "61", flags: "K__",
          ...(showData ? { data } : {}), ...(showHash ? { data_hash: dataHash } : {})
        }] });
    });
  }
}
