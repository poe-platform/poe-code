import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [name, size, skip, truncate, succeeds, expected] of [
  ["complete sound", 16, 0, 0, true, "1234fedc7fff8000"],
  ["oversized final SSND", 4096, 0, 0, true, "1234fedc7fff8000"],
  ["oversized SSND with offset", 4096, 2, 0, true, "fedc7fff8000"],
  ["offset beyond available sound", 4096, 9, 0, true, ""],
  ["incomplete SSND prefix", 4096, 0, 9, false, ""],
  ["undersized SSND prefix", 7, 0, 0, false, ""]
] as const) {
  it(`copies AIFF with ${name} safely through the public command`, async () => {
    const bytes = Buffer.from("464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000001234fedc7fff8000", "hex");
    bytes.writeUInt32BE(size, 42);
    bytes.writeUInt32BE(skip, 46);
    bytes.writeUInt32BE(bytes.length - truncate - 8, 4);
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
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), succeeds ? expected : Buffer.from("keep").toString("hex"));
  });
}
