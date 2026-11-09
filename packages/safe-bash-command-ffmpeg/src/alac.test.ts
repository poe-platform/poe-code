import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

it("honors the ALAC encoder in async and sync MOV output and preserves stream copies", async () => {
  const input = Buffer.alloc(8200 * 4);
  for (let i = 0; i < 8200; i++) {
    input.writeInt16LE(i, i * 4);
    input.writeInt16LE(111, i * 4 + 2);
  }
  const volume = Volume.fromJSON({ "/source.raw": input, "/out.mov": "keep" });
  const args = ["-v", "error", "-y", "-f", "s16le", "-ar", "8000", "-ac", "2", "-i", "/source.raw", "-c:a", "alac", "/out.mov"];
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
  const verify = (path: string) => {
    const output = volume.readFileSync(path) as Buffer;
    const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "json", "pipe:0"], { input: output });
    assert.equal(probe.status, 0, probe.stderr.toString());
    assert.equal(JSON.parse(probe.stdout.toString()).streams[0].codec_name, "alac");
    const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-c:a", "pcm_s16le", "-f", "s16le", "pipe:1"], { input: output });
    assert.equal(decoded.status, 0, decoded.stderr.toString());
    assert.deepEqual(decoded.stdout, input);
  };
  verify("/out.mov");
  const read = (path: string) => volume.existsSync(path) ? volume.readFileSync(path) as Buffer : undefined;
  const write = (path: string, bytes: Uint8Array) => { volume.writeFileSync(path, bytes); return true; };
  assert.equal(evalSyncFfmpeg([...args.slice(0, -1), "/sync.mov"], undefined, read, write), "");
  verify("/sync.mov");
  assert.equal(evalSyncFfmpeg(["-i", "/out.mov", "-c:a", "copy", "/copy.mov"], undefined, read, write), "");
  verify("/copy.mov");
});
