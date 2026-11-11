import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 digests for 10 mono PCM16 samples at 8 kHz.
for (const format of ["framehash", "framemd5"]) {
  for (const algorithm of ["murmur3", "MURMUR3", "MuRmUr3"]) {
    for (const filter of ["anull", "asetnsamples=n=4:p=0,areverse"]) {
      for (const target of ["-", "/frames.txt"]) {
        it(`${format} ${algorithm} with ${filter} to ${target} matches native packet hashes`, async () => {
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
          assert.equal(stderr, "");
          const output = target === "-" ? stdout : volume.readFileSync(target, "utf8").toString();
          if (target !== "-") assert.equal(stdout, "");
          assert.ok(output.includes("#hash: murmur3\n"), output);
          assert.deepEqual(output.split("\n").filter(line => line && !line.startsWith("#"))
            .map(line => line.split(",").slice(3).map(field => field.trim())), filter === "anull" ? [
              ["10", "20", "7fbacf34bf01c6329df782afe8ddd566"]
            ] : [
              ["2", "4", "bcea377a01d42aacf3dc2329c558bdcc"],
              ["4", "8", "97003421f1fc32f64660eec974c95f0c"],
              ["4", "8", "1d467187ca7496848a4333b592650777"]
            ]);
        });
      }
    }
  }
}
