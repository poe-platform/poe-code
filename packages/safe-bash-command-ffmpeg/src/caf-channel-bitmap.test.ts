import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Independent CAF PCM16 fixture: [1000,9000], [2000,8000], [3000,7000], [4000,6000].
// Native FFmpeg 7.0.2 retains FC and excludes LFE when mixing bitmap 12 to mono.
const fixture = "636166660001000064657363000000000000002040bf4000000000006c70636d00000000000000040000000100000002000000106368616e000000000000000c000100000000000c000000006461746100000000000000140000000003e8232807d01f400bb81b580fa01770";

for (const mask of [3, 12]) for (const late of [false, true]) {
  for (const input of ["/in.caf", "pipe:0"]) for (const output of ["/out.raw", "pipe:1"]) {
    it(`mixes CAF bitmap ${mask} with ${late ? "trailing" : "leading"} chan from ${input} to ${output}`, async () => {
      let bytes = Buffer.from(fixture, "hex");
      bytes.writeUInt32BE(mask, 68);
      if (late) bytes = Buffer.concat([bytes.subarray(0, 52), bytes.subarray(76), bytes.subarray(52, 76)]);
      const volume = Volume.fromJSON({ "/in.caf": bytes });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-i", input, "-ac", "1", "-f", "s16le", output],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { if (input === "pipe:0") yield bytes; })(),
        stdout: { async write(data: Uint8Array) { stdout.push(data.slice()); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const actual = output === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(output) as Buffer;
      assert.equal(actual.length, 8);
      assert.deepEqual([0, 2, 4, 6].map(offset => actual.readInt16LE(offset)),
        mask === 12 && !(late && input === "pipe:0") ? [1000, 2000, 3000, 4000] : [5000, 5000, 5000, 5000]);
    });
  }
}
