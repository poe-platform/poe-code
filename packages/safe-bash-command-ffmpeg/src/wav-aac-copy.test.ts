import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

it("copies M4A AAC into WAV with the native compressed payload", async () => {
  const volume = Volume.fromJSON({
    "/input.m4a": readFileSync(new URL("../../mp4-ast/src/fixtures/aac-copy.m4a", import.meta.url))
  });
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", "-y", "-i", "/input.m4a", "-map", "0:a:0", "-c:a", "copy", "/out.wav"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = volume.readFileSync("/out.wav") as Buffer;
  assert.equal(output.toString("ascii", 0, 4), "RIFF");
  assert.equal(output.toString("ascii", 8, 12), "WAVE");
  const chunks = new Map<string, Buffer>();
  for (let offset = 12; offset + 8 <= output.length;) {
    const length = output.readUInt32LE(offset + 4);
    chunks.set(output.toString("ascii", offset, offset + 4), output.subarray(offset + 8, offset + 8 + length));
    offset += 8 + length + length % 2;
  }
  assert.equal(chunks.get("fmt ")!.toString("hex"), "ff00010080bb0000f0220000000310000500118856e50000");
  assert.equal(chunks.get("fact")!.readUInt32LE(), 35584);
  assert.equal(chunks.get("data")!.length, 6631);
  assert.equal(createHash("sha256").update(chunks.get("data")!).digest("hex"),
    "5263e668cb6611c2ee7a6c41d32bfd091b84eaf75a6884b2696f627d9d477f99");
});
