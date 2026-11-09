import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [name, formSize, truncate, succeeds] of [
  ["accurate FORM", 54, 0, true],
  ["oversized FORM", 9999, 0, true],
  ["FORM one byte short", 53, 0, true],
  ["FORM without chunks", 4, 0, false],
  ["truncated sound", 9999, 1, true],
  ["truncated chunk header", 9999, 23, false]
] as const) {
  it(`copies AIFF with ${name} safely through the public command`, async () => {
    const bytes = Buffer.from("464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000001234fedc7fff8000", "hex");
    bytes.writeUInt32BE(formSize, 4);
    const volume = Volume.fromJSON({ "/out.raw": "keep" });
    volume.writeFileSync("/in.aiff", bytes.subarray(0, bytes.length - truncate));
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
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), succeeds ? bytes.subarray(54, bytes.length - truncate).toString("hex") : Buffer.from("keep").toString("hex"));
  });
}
