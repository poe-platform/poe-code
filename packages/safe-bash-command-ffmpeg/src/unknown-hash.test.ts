import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const format of ["framehash", "framemd5", "streamhash", "hash"]) {
  for (const algorithm of ["nosuchhash", "xxh64", "CRC32"]) {
    for (const target of ["/existing.txt", "/new.txt", "-"]) {
      for (const overwrite of [true, false]) {
        it(`${format} ${algorithm} to ${target} with overwrite=${overwrite}`, async () => {
          const volume = Volume.fromJSON({ "/existing.txt": "OLD" });
          volume.writeFileSync("/in.raw", Buffer.from("000100020003000400050006000700080009000a", "hex"));
          let stdout = "", stderr = "";
          const result = await createFfmpegCommand().execute({
            args: [...(overwrite ? ["-y"] : []), "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1",
              "-i", "/in.raw", "-af", "anull", "-hash", algorithm, "-f", format, target],
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
          if (!overwrite && target === "/existing.txt") {
            assert.equal(result.exitCode, 1);
            assert.ok(stderr.includes("already exists"), stderr);
            assert.equal(volume.readFileSync(target, "utf8"), "OLD");
          } else if (algorithm === "CRC32") {
            assert.equal(result.exitCode, 0, stderr);
            const output = target === "-" ? stdout : volume.readFileSync(target, "utf8") as string;
            assert.ok(output.includes("c551f9eb"), output);
          } else {
            assert.equal(result.exitCode, 234, stderr);
            assert.ok(stderr.includes(`Unknown hash algorithm '${algorithm}'`), stderr);
            assert.ok(stderr.includes("Could not write header"), stderr);
            assert.equal(stdout, "");
            if (target !== "-") assert.equal(volume.readFileSync(target, "utf8"), "");
          }
          if (target !== "/existing.txt") assert.equal(volume.readFileSync("/existing.txt", "utf8"), "OLD");
        });
      }
    }
  }
}
