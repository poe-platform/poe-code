import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Four stereo PCM16 frames, with a known-length CAF data chunk.
const input = Buffer.from("636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000040000000100000002000000106461746100000000000000140000000003e8232807d01f400bb81b580fa01770", "hex");

for (const codec of ["copy", "pcm_s16le"]) {
  for (const source of ["/in.caf", "pipe:0"]) {
    for (const target of ["/out.caf", "pipe:1", "-"]) {
      it(`writes the CAF data size for ${codec} from ${source} to ${target}`, async () => {
        const volume = Volume.fromJSON({ "/in.caf": input });
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createFfmpegCommand().execute({
          args: ["-y", "-v", "error", "-i", source, "-c:a", codec,
            "-metadata", "title=Pipe output", "-f", "caf", target],
          cwd: "/", env: {}, signal: new AbortController().signal,
          fs: {
            async readFile(path: string) { return volume.readFileSync(path); },
            async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
            async stat(path: string) { return volume.statSync(path); }
          },
          stdin: (async function* () { if (source === "pipe:0") yield input; })(),
          stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
          stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
        } as never);
        assert.equal(result.exitCode, 0, stderr);
        const output = target === "/out.caf" ? volume.readFileSync(target) as Buffer : Buffer.concat(chunks);
        assert.equal(output.toString("ascii", 0, 4), "caff");
        let offset = 8;
        while (output.toString("ascii", offset, offset + 4) !== "data") {
          const size = output.readBigInt64BE(offset + 4);
          assert.ok(size >= 0n && size <= BigInt(output.length - offset - 12));
          offset += 12 + Number(size);
        }
        assert.equal(output.readBigInt64BE(offset + 4), target === "/out.caf" ? 20n : -1n);
        assert.equal(output.readUInt32BE(offset + 12), 0);
        const expected = Buffer.from(input.subarray(68));
        if (codec === "pcm_s16le") expected.swap16();
        assert.deepEqual(output.subarray(offset + 16), expected);
      });
    }
  }
}
