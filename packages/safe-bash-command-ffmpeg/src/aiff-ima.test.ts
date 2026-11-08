import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Generated independently with native FFmpeg from PCM16 [100, -200, 300, -400].
const fixtures = [["ima4", "464f524d00000062414946434656455200000004a2805140434f4d4d000000180001000000010004400bfa00000000000000696d6134000053534e440000002a00000000000000000000f7f7828080808000080808088880808080800000000000000000000000000000", "0b00edff2c00a4ff0500f4ff0400f6ff0300f7ff0200f8ff0100f9ff00000600000005000000040000000300000003000100ffff0100ffff010000000100000001000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"]] as const;
for (const input of ["/in.aiff", "pipe:0", "pipe:", "-"]) {
  for (const [codec, hex, expected] of fixtures) {
    it(`decodes ${codec} AIFF-C from ${input} through the command APIs`, async () => {
      const bytes = Buffer.from(hex, "hex");
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.aiff", bytes);
      const args = ["-y", "-v", "error", "-i", input, "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(name: string) { return volume.readFileSync(name); },
          async writeFile(name: string, data: Uint8Array) { volume.writeFileSync(name, data); },
          async stat(name: string) { return volume.statSync(name); }
        },
        stdin: (async function* () { yield bytes; })(), stdout: { async write() {} },
        stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
      volume.unlinkSync("/out.raw");
      assert.equal(evalSyncFfmpeg(bytes, args,
        name => volume.existsSync(name) ? volume.readFileSync(name) as Buffer : undefined,
        (name, data) => { volume.writeFileSync(name, data); return true; }), "");
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    });
  }
}
