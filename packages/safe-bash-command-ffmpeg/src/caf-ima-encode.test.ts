import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

for (const sync of [false, true]) {
  it(`encodes stereo IMA4 CAF with native packet padding (${sync ? "sync" : "async"})`, async () => {
    const source = Buffer.alloc(8200 * 4);
    for (let i = 0; i < 8200; i++) {
      source.writeInt16LE(i < 4096 ? i % 16 : (i * 3503) % 60000 - 30000, i * 4);
      source.writeInt16LE(i < 4096 ? 111 : 19000 - i, i * 4 + 2);
    }
    assert.equal(createHash("sha256").update(source).digest("hex"), "50d5595b384041baf4e0d17bef38434d327019e750cd522c87b3cf80a6fc41bf");
    const volume = Volume.fromJSON({ "/out.caf": "keep" });
    volume.writeFileSync("/source.raw", source);
    const read = (path: string) => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined;
    const write = (path: string, data: Uint8Array) => { volume.writeFileSync(path, data); return true; };
    const args = ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/source.raw", "-c:a", "adpcm_ima_qt", "-f", "caf", "/out.caf"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined, read, write), "");
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
    const output = read("/out.caf")!;
    assert.equal(output.toString("ascii", 28, 32), "ima4");
    assert.equal(output.readUInt32BE(36), 68);
    assert.equal(output.readUInt32BE(40), 64);
    const dataOffset = output.indexOf("data", 52);
    assert.ok(dataOffset >= 52);
    const packets = output.subarray(dataOffset + 16);
    assert.equal(packets.length, 129 * 68);
    // Native FFmpeg packet bytes; independent of the CAF decoder.
    assert.equal(createHash("sha256").update(packets).digest("hex"), "d5f5200650a20688bb1cae0e1ea321bb63fdd2409f21b7b372d59994e758df87");
  });
}
