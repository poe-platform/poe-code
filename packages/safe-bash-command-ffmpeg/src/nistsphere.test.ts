import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [fixture, filename, valid] of [
  ["little.sph", "little.sph", true],
  ["big.sph", "big.sph", true],
  ["little.sph", "valid-blob", true],
  ["bad.sph", "bad.sph", true],
  ["bad.sph", "invalid-blob", false],
  ["same.wav", "same.wav", true]
] as const) {
  it(`decodes NIST reference ${filename} and preserves output on rejection`, async () => {
    const input = readFileSync(new URL(`../../mp4-ast/src/fixtures/nist-${fixture}`, import.meta.url));
    const volume = Volume.fromJSON({ [`/${filename}`]: input, "/out.raw": "KEEP" });
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-y", "-v", "error", "-i", `/${filename}`, "-f", "s16le", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(name: string) { return volume.readFileSync(name); },
        async writeFile(name: string, bytes: Uint8Array) { volume.writeFileSync(name, bytes); },
        async stat(name: string) { return volume.statSync(name); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, valid ? 0 : 1, stderr);
    assert.deepEqual(volume.readFileSync("/out.raw"), valid
      ? Buffer.from("c7cfce560000ffffff7f00809d0010ff", "hex") : Buffer.from("KEEP"));
  });
}
