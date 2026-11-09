import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [name, tail, succeeds] of [
  ["padded unknown chunk", "585452410000000568656c6c6f00", true],
  ["stray trailing byte", "ff", true],
  ["unknown chunk extending beyond EOF", "58545241000010006162", true],
  ["odd unknown chunk without padding", "585452410000000161", true],
  ["truncated trailing COMM", "434f4d4d000000120001", false],
  ["truncated trailing SSND prefix", "53534e440000001000", false],
  ["truncated trailing NAME", "4e414d450000001061", false]
] as const) {
  it(`handles AIFF ${name} through the public command`, async () => {
    const bytes = Buffer.from("464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000001234fedc7fff8000" + tail, "hex");
    bytes.writeUInt32BE(bytes.length - 8, 4);
    const volume = Volume.fromJSON({ "/out.raw": "keep" });
    volume.writeFileSync("/in.aiff", bytes);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.aiff", "-c:a", "copy", "-f", "s16be", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(name: string) { return volume.readFileSync(name); },
        async writeFile(name: string, data: Uint8Array) { volume.writeFileSync(name, data); },
        async stat(name: string) { return volume.statSync(name); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, succeeds ? 0 : 1, stderr);
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), succeeds ? "1234fedc7fff8000" : Buffer.from("keep").toString("hex"));
  });
}
