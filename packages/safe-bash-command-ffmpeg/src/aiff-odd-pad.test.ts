import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const padded of [false, true]) {
  it(`copies all three AIFF samples ${padded ? "with" : "without"} a final pad byte`, async () => {
    const bytes = Buffer.from("464f524d0000003141494646434f4d4d000000120001000000030008400bfa0000000000000053534e440000000b0000000000000000616263" + (padded ? "00" : ""), "hex");
    bytes.writeUInt32BE(bytes.length - 8, 4);
    const volume = Volume.fromJSON({ "/out.raw": "keep" });
    volume.writeFileSync("/in.aiff", bytes);
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-y", "-i", "/in.aiff", "-c:a", "copy", "-f", "s8", "/out.raw"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(name: string) { return volume.readFileSync(name); },
        async writeFile(name: string, data: Uint8Array) { volume.writeFileSync(name, data); },
        async stat(name: string) { return volume.statSync(name); }
      },
      stdin: (async function* () {})(), stdout: { async write() {} },
      stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), "616263");
  });
}
