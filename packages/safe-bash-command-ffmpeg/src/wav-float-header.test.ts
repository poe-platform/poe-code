import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

it("writes the float32 WAV format extension and fact count without changing PCM", async () => {
  const input = Buffer.from("UklGRlwAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAATElTVCYAAABJTkZPSU5BTQoAAABPbGQgdGl0bGUASUFSVAcAAABQbGF5ZXIAAGRhdGEKAAAAAIAA/wAAAAEAfw==", "base64");
  const volume = Volume.fromJSON({});
  volume.writeFileSync("/in.wav", input);
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-i", "/in.wav", "-c:a", "pcm_f32le", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = volume.readFileSync("/out.wav") as Buffer;
  const chunks = new Map<string, Buffer>();
  for (let offset = 12; offset + 8 <= output.length;) {
    const size = output.readUInt32LE(offset + 4);
    chunks.set(output.toString("ascii", offset, offset + 4), output.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  const format = chunks.get("fmt ")!;
  assert.equal(format.length, 18);
  assert.equal(format.readUInt16LE(0), 3);
  assert.equal(format.readUInt16LE(16), 0);
  assert.deepEqual(chunks.get("fact"), Buffer.from([5, 0, 0, 0]));
  assert.equal(output.readUInt32LE(4), output.length - 8);
  const expected = Buffer.alloc(20);
  [-1, -1 / 128, 0, 1 / 128, 127 / 128].forEach((value, i) => expected.writeFloatLE(value, i * 4));
  assert.deepEqual(chunks.get("data"), expected);
});
