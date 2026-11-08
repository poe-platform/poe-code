import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Generated independently with native FFmpeg from PCM16 [100, -200, 300, -400].
const fixtures = [[32, "464f524d00000050414946434656455200000004a2805140434f4d4d000000180001000000040020400bfa00000000000000666c3332000053534e440000001800000000000000003b480000bbc800003c160000bc480000"], [64, "464f524d00000060414946434656455200000004a2805140434f4d4d000000180001000000040040400bfa00000000000000666c3634000053534e440000002800000000000000003f69000000000000bf790000000000003f82c00000000000bf89000000000000"]] as const;
for (const input of ["/in.aiff", "pipe:0", "pipe:", "-"]) {
  for (const [bits, hex] of fixtures) {
    it(`decodes fl${bits} AIFF-C from ${input} through the command APIs`, async () => {
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
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), "640038ff2c0170fe");
      volume.unlinkSync("/out.raw");
      assert.equal(evalSyncFfmpeg(bytes, args,
        name => volume.existsSync(name) ? volume.readFileSync(name) as Buffer : undefined,
        (name, data) => { volume.writeFileSync(name, data); return true; }), "");
      assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), "640038ff2c0170fe");
    });
  }
}
