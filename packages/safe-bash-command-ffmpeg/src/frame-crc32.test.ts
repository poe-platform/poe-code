import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { encodeWav } from "@poe-code/audio-ast";
import { createFfmpegCommand } from "./index.js";

for (const format of ["framehash", "framemd5"]) {
  for (const algorithm of ["CRC32", "crc32"]) {
    for (const target of ["-", "/frames.txt"]) {
      it(`${format} ${algorithm} to ${target} matches native FFmpeg packet checksums`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.wav", encodeWav({ sampleRate: 8000,
          channels: [Float64Array.from({ length: 1200 }, (_, i) => i / 32768)] }));
        let stdout = "", stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", "-f", format, "-hash", algorithm, target],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = target === "-" ? stdout : volume.readFileSync(target, "utf8") as string;
        assert.ok(output.includes("#hash: CRC32\n"));
        assert.deepEqual(output.split("\n").filter(line => line && !line.startsWith("#"))
          .map(line => line.split(",").map(field => field.trim())), [
          ["0", "0", "0", "512", "1024", "373f4c49"],
          ["0", "512", "512", "512", "1024", "1f15e38a"],
          ["0", "1024", "1024", "176", "352", "505e55ae"]
        ]);
      });
    }
  }
}
