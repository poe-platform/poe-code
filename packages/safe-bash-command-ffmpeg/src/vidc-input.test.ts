import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Independently decoded by native FFmpeg 7.0.2; no encoder round trip.
const input = Buffer.from("00010f1040557f8081aad5feff", "hex");
const golden = {
  vidc: "00000000c8ff40008c0134fda4f8bc0744f8fc1484cb7c7d8482",
  mulaw: "8482848684be84c1a4f834fd00007c7d7c79fc14cc0208000000"
};

for (const [format, hex] of Object.entries(golden)) for (const channels of [1, 2]) for (const sync of [false, true]) {
  it(`decodes raw ${format} codewords with ${channels} channels (${sync ? "sync" : "pipe"})`, async () => {
    const pcm = Buffer.from(hex, "hex");
    const bytes = channels === 1 ? input : Buffer.concat([input, input]);
    const expected = channels === 1 ? pcm : Buffer.concat([pcm, pcm]);
    const volume = Volume.fromJSON({ "/in.raw": bytes });
    const args = ["-v", "error", ...(sync ? ["-y"] : []), "-f", format, "-ar", "8000", "-ac", String(channels),
      "-i", sync ? "/in.raw" : "pipe:0", "-f", "s16le", sync ? "/out.raw" : "pipe:1"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, data) => { volume.writeFileSync(path, data); return true; }), "");
      assert.deepEqual(volume.readFileSync("/out.raw"), expected);
    } else {
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, data: Uint8Array) { volume.writeFileSync(path, data); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { yield bytes.subarray(0, 5); yield bytes.subarray(5); })(),
        stdout: { async write(data: Uint8Array) { stdout.push(Buffer.from(data)); } },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      assert.deepEqual(Buffer.concat(stdout), expected);
    }
  });
}
