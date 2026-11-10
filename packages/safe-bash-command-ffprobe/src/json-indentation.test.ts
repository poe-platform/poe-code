import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand } from "./index.js";
import { evalSyncFfprobe } from "./media.js";

const bytes = Buffer.from("524946464e00000057415645666d74201000000001000100401f0000803e0000020010004c49535412000000494e464f494e414d060000005469746c6500646174611000000000000000000000000000000000000000", "hex");
// Literal stdout from native ffprobe 7.0.2 for the WAV above.
const expected = `{
    "packets_and_frames": [
        {
            "type": "packet",
            "size": "16"
        },
        {
            "type": "frame",
            "nb_samples": 8
        }
    ]
}
`;

for (const writer of ["json", "json=c=0", "json=compact=0"]) {
  for (const route of ["automatic", "explicit", "stdin", "readFile"]) {
    it(`matches native interleaved JSON indentation via ${route}, ${writer}`, async () => {
      const base = new MemoryFileSystem();
      await base.writeFile("/input.wav", bytes);
      const fs = route === "readFile" ? new Proxy(base, {
        get(target, key) {
          if (key === "openReadFile" || key === "readStream") return undefined;
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
      }) : base;
      const args = ["-v", "error", ...(route === "explicit" ? ["-f", "wav"] : []), "-of", writer,
        "-show_entries", "packet=size:frame=nb_samples", route === "stdin" ? "-" : "/input.wav"];
      let stdout = "", stderr = "";
      const result = await createFfprobeCommand().execute({
        command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal,
        stdin: { async *[Symbol.asyncIterator]() { yield bytes; } },
        stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
      });
      expect(result.exitCode, stderr).toBe(0);
      expect(stderr).toBe("");
      expect(stdout).toBe(expected);
      expect(evalSyncFfprobe(bytes, args, () => bytes)).toBe(expected);
    });
  }
}
