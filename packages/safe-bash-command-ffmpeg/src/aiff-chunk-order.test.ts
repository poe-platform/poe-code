import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const pcm = Buffer.from("0102fcff", "hex");
// FFmpeg 7.0.2: -f s16le -ar 8000 -ac 2 -i pipe:0 [-metadata 'title=Room A'] -f aiff out.aiff.
const native = [
  "464f524d0000003241494646434f4d4d000000120002000000010010400bfa0000000000000053534e440000000c00000000000000000201fffc",
  "464f524d00000040414946464e414d4500000006526f6f6d2041434f4d4d000000120002000000010010400bfa0000000000000053534e440000000c00000000000000000201fffc"
];

for (const title of [false, true]) for (const bitexact of [false, true]) {
  for (const output of ["/out.aiff", "pipe:1"]) {
    it(`writes native AIFF chunk order from one-byte stdin chunks (title=${title}, bitexact=${bitexact}, output=${output})`, async () => {
      const volume = Volume.fromJSON({});
      const args = ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "pipe:0",
        ...(title ? ["-metadata", "title=Room A"] : []), ...(bitexact ? ["-bitexact"] : []), "-f", "aiff", output];
      const stdout: Buffer[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () { for (const byte of pcm) yield Uint8Array.of(byte); })(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stderr, "");
      const expected = Buffer.from(native[Number(title)]!, "hex");
      if (output === "pipe:1") {
        const comm = title ? 26 : 12;
        for (const offset of [4, comm + 10, comm + 30]) expected.writeUInt32BE(0, offset);
      }
      assert.deepEqual(output === "pipe:1" ? Buffer.concat(stdout) : volume.readFileSync(output), expected);
      if (output !== "pipe:1") {
        assert.equal(evalSyncFfmpeg(pcm, args, undefined,
          (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), "");
        assert.deepEqual(volume.readFileSync(output), expected);
      }
    });
  }
}
