import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const [name, hex, expected] of [
  ["partial", "464f524d0000003441494646434f4d4d000000120001000000020010400bfa0000000000000053534e440000000d00000000000000001234fedc7f00", "1234fedc7f"],
  ["aligned", "464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000001234fedc7fff8000", "1234fedc7fff8000"]
] as const) {
  it(`stream copies ${name} AIFF sample bytes without the SSND alignment pad`, async () => {
    const bytes = Buffer.from(hex, "hex");
    const volume = Volume.fromJSON({ "/in.aiff": bytes, "/out.raw": "keep" });
    const args = ["-v", "error", "-y", "-i", "/in.aiff", "-c:a", "copy", "-f", "s16be", "/out.raw"];
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
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
    volume.writeFileSync("/out.raw", "keep");
    assert.equal(evalSyncFfmpeg(args, undefined,
      name => volume.existsSync(name) ? volume.readFileSync(name) as Buffer : undefined,
      (name, data) => { volume.writeFileSync(name, data); return true; }), "");
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
  });
}
