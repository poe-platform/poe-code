import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const duplicate of [false, true]) {
  it(`decodes ${duplicate ? "duplicate" : "single"} AIFF COMM headers through both command APIs`, async () => {
    let bytes = Buffer.from("464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000000064ff38012cfe70", "hex");
    if (duplicate) {
      const finalComm = Buffer.from(bytes.subarray(12, 38));
      finalComm.writeUInt16BE(0x400a, 16);
      bytes = Buffer.concat([bytes.subarray(0, 38), finalComm, bytes.subarray(38)]);
      bytes.writeUInt32BE(bytes.length - 8, 4);
    }
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
