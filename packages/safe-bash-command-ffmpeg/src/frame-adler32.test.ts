import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["framehash", "framemd5"]) {
  for (const algorithm of ["adler32", "ADLER32"]) {
    for (const filter of ["anull", "asetnsamples=n=4:p=0,areverse"]) {
      for (const target of ["-", "/frames.txt"]) {
        it(`${format} ${algorithm} with ${filter} to ${target} matches native packet checksums`, async () => {
          const volume = Volume.fromJSON({});
          volume.writeFileSync("/in.raw", Buffer.from("000100020003000400050006000700080009000a", "hex"));
          let stdout = "", stderr = "";
          const result = await createFfmpegCommand().execute({
            args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
              "-af", filter, "-hash", algorithm, "-f", format, target],
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
          assert.ok(output.includes("#hash: adler32\n"), output);
          // FFmpeg 7.0.2 reference: Adler-32 starts at one independently for each packet.
          assert.deepEqual(output.split("\n").filter(line => line && !line.startsWith("#"))
            .map(line => line.split(",").slice(3).map(field => field.trim())), filter === "anull" ? [
              ["10", "20", "01950038"]
            ] : [
              ["2", "4", "002b0014"],
              ["4", "8", "007a001b"],
              ["4", "8", "003a000b"]
            ]);
        });
      }
    }
  }
}
