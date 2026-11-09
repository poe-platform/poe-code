import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

it("encodes little-endian G.726 AU matching native FFmpeg and decoded PCM", async () => {
  const input = Buffer.alloc(1024);
  for (let i = 0; i < 512; i++) input.writeInt16LE((i * 2003 % 50000) - 25000, i * 2);
  const volume = Volume.fromJSON({ "/out.au": "keep" });
  volume.writeFileSync("/source.raw", input);
  const run = async (args: string[]) => {
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
  };
  await run(["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/source.raw", "-c:a", "g726le", "-b:a", "32000", "-f", "au", "/out.au"]);
  assert.deepEqual(volume.readFileSync("/out.au"), readFileSync(new URL("../../mp4-ast/src/fixtures/g726le32000.au", import.meta.url)));
  await run(["-v", "error", "-y", "-i", "/out.au", "-c:a", "pcm_s16le", "-f", "s16le", "/decoded.raw"]);
  const decoded = volume.readFileSync("/decoded.raw") as Buffer;
  assert.equal(decoded.length, 1024);
  assert.equal(createHash("sha256").update(decoded).digest("hex"), "bc312e6f423dbfaa6a2c768c73801f38f10c9c2320ec7d0bdba50d4a2c2d0eeb");
});
