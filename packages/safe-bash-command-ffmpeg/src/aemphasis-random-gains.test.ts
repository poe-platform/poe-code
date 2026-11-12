import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg 7.0.2 PCM16 hashes for 32 mono samples i * 300 - 4000 at 8 kHz.
const cases = [
  ["1+random(0)", "afbff46662679c800a423e6eaecea0174906402bdc56a5c0c783996345522039"],
  [String.raw`1+randomi(0\,0\,2)`, "8ac2165ce4e7ccf817744a26b26386369e96ed17851a613f37649c59a9aac928"],
  [String.raw`randomi(0\,2\,2)`, "0a06f1ae7c7c6c8767c67ba3fdf55ea1acb82841c5be9aa8bb1d7d3afdad46ba"],
  ["2", "0a06f1ae7c7c6c8767c67ba3fdf55ea1acb82841c5be9aa8bb1d7d3afdad46ba"],
  ["1", "15960665b6431b1ddc89a29b155196ef3a691875bc7346e1999f601873284598"]
] as const;

for (const graph of [false, true]) {
  for (const gain of ["level_in", "level_out"]) {
    for (const [expression, hash] of cases) {
      for (const timed of [false, true]) {
        it(`matches native aemphasis ${gain}=${expression} (${graph ? "graph" : "simple"}, ${timed ? "scheduled" : "startup"})`, async () => {
          const input = Buffer.alloc(64);
          for (let i = 0; i < 32; i++) input.writeInt16LE(i * 300 - 4000, i * 2);
          const volume = Volume.fromJSON({ "/in.raw": input });
          const chunks: Buffer[] = [];
          let stderr = "";
          const filter = timed
            ? `asendcmd=c='0 aemphasis ${gain} ${expression.replaceAll("\\,", ",")}',aemphasis`
            : `aemphasis=${gain}=${expression}`;
          const result = await createFfmpegCommand().execute({
            args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw", ...(graph
              ? ["-filter_complex", `[0:a]${filter}[out]`, "-map", "[out]"] : ["-af", filter]), "-f", "s16le", "pipe:1"],
            cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(),
            stdout: { async write(bytes: Uint8Array) { chunks.push(Buffer.from(bytes)); } },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
          assert.equal(stderr, "");
          const output = Buffer.concat(chunks);
          assert.equal(output.length, 64);
          assert.equal(createHash("sha256").update(output).digest("hex"), hash);
        });
      }
    }
  }
}
