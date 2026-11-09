import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

for (const [name, sound, frames, expected] of [
  ["offset beyond payload", "00000009000000001234fedc7fff8000", 0, ""],
  ["maximum offset", "ffffffff000000001234fedc7fff8000", 0, ""],
  ["offset at payload end", "00000008000000001234fedc7fff8000", 0, ""],
  ["empty payload", "0000000000000000", 0, ""],
  ["offset before real samples", "00000003000000006162631234fedc7fff8000", 4, "1234fedc7fff8000"]
] as const) {
  it(`copies AIFF with ${name}`, async () => {
    const payload = Buffer.from(sound, "hex");
    const bytes = Buffer.concat([
      Buffer.from("464f524d0000000041494646434f4d4d000000120001000000000010400bfa0000000000000053534e4400000000", "hex"),
      payload, Buffer.alloc(payload.length % 2)
    ]);
    bytes.writeUInt32BE(bytes.length - 8, 4);
    bytes.writeUInt32BE(frames, 22);
    bytes.writeUInt32BE(payload.length, 42);
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
    assert.equal(result.exitCode, 0, stderr);
    assert.equal((volume.readFileSync("/out.raw") as Buffer).toString("hex"), expected);
  });
}
