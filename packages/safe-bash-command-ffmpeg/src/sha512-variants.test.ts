import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

const input = readFileSync(new URL("./fixtures/sha512-variants.wav", import.meta.url));
// Native FFmpeg reference digests for the mono 8 kHz PCM fixture.
const variants = [
  ["SHA512/224", "sha512-224", "121dacdf14ee2b2873891754649d412aacad0debcbd2d9daba9664bf"],
  ["SHA512/256", "sha512-256", "0ed67e297adc3951b3de794306d8f03066296db1e3e5c45ed1441d5cd3617446"]
] as const;

for (const [label, nodeAlgorithm, digest] of variants) {
  for (const algorithm of [label, label.toLowerCase()]) {
    for (const format of ["streamhash", "hash", "md5", "framehash", "framemd5"]) {
      it(`${format} supports ${algorithm} with the SHA-512 variant digest and label`, async () => {
        const volume = Volume.fromJSON({ "/in.wav": input });
        const output: Uint8Array[] = [], errors: Uint8Array[] = [];
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", "/in.wav", "-hash", algorithm, "-f", format, "/out.txt"],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async stat(path: string) { return volume.statSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
          },
          stdin: (async function* () {})(),
          stdout: { async write(bytes: Uint8Array) { output.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { errors.push(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, Buffer.concat(errors).toString());
        assert.equal(Buffer.concat(output).length, 0);
        const text = volume.readFileSync("/out.txt", "utf8") as string;
        if (!format.startsWith("frame")) {
          assert.equal(text, `${format === "streamhash" ? "0,a," : ""}${label}=${digest}\n`);
        } else {
          assert.ok(text.includes(`#hash: ${label}\n`));
          let offset = 44;
          for (const line of text.trim().split("\n").filter(line => !line.startsWith("#"))) {
            const fields = line.split(",").map(field => field.trim());
            const size = Number(fields[4]);
            assert.equal(fields[5], createHash(nodeAlgorithm).update(input.subarray(offset, offset + size)).digest("hex"));
            offset += size;
          }
          assert.equal(offset, input.length);
        }
      });
    }
  }
}
