import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const rate of [8000, 8000.25, 8000.5, 8000.75]) {
  it(`decodes fractional AIFF rate ${rate} to exact PCM through both command APIs`, async () => {
    const bytes = Buffer.from("464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000000064ff38012cfe70", "hex");
    bytes.writeBigUInt64BE(BigInt(rate * 2 ** 51), 30);
    const volume = Volume.fromJSON({});
    volume.writeFileSync("/in.aiff", bytes);
    const args = ["-y", "-v", "error", "-i", "/in.aiff", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args, cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(name: string) { return volume.readFileSync(name); },
        async writeFile(name: string, data: Uint8Array) { volume.writeFileSync(name, data); },
        async stat(name: string) { return volume.statSync(name); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), "640038ff2c0170fe");
    volume.unlinkSync("/out.raw");
    assert.equal(evalSyncFfmpeg(args, undefined,
      name => volume.existsSync(name) ? volume.readFileSync(name) as Buffer : undefined,
      (name, data) => { volume.writeFileSync(name, data); return true; }), "");
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), "640038ff2c0170fe");
  });
}
