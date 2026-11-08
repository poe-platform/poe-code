import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";


// Independent PCM16 fixture: negative full scale, negative half scale, silence,
// positive half scale, and the largest whole unsigned 8-bit sample.
const golden = {
  u8: "004080c0ff",
  u16le: "00000040008000c000ff",
  u16be: "000040008000c000ff00",
  u24le: "0000000000400000800000c00000ff",
  u24be: "000000400000800000c00000ff0000",
  u32le: "000000000000004000000080000000c0000000ff",
  u32be: "000000004000000080000000c0000000ff000000"
};

for (const [format, hex] of Object.entries(golden)) {
  for (const sync of [false, true]) {
    for (const explicitCodec of [false, true]) {
      it(`writes headerless ${format} with ${explicitCodec ? "explicit" : "default"} codec (${sync ? "sync" : "async"})`, async () => {
        const volume = Volume.fromJSON({});
        volume.writeFileSync("/in.raw", Buffer.from("008000c000000040007f", "hex"));
        const args = ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          ...(explicitCodec ? ["-c:a", `pcm_${format}`] : []), "-f", format, "/out.raw"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            path => volume.readFileSync(path) as Buffer,
            (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(path: string) { return volume.readFileSync(path); },
              async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
              async stat(path: string) { return volume.statSync(path); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }

        assert.deepEqual(volume.readFileSync("/out.raw"), Buffer.from(hex, "hex"));
      });
    }
  }
}
