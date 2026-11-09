import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

const input = readFileSync(new URL("../../mp4-ast/src/fixtures/amr-nb-decode.3gp", import.meta.url));
const reference = readFileSync(new URL("../../mp4-ast/src/fixtures/amr-nb.s16", import.meta.url));
for (const sync of [false, true]) for (const malformed of [false, true]) {
  it(`decodes 3GP AMR-NB to native PCM${malformed ? " rejects malformed input" : ""} (${sync ? "sync" : "async"})`, async () => {
    const volume = Volume.fromJSON({ "/out.raw": "KEEP" });
    const bytes = Buffer.from(input);
    if (malformed) bytes[44] = 0x78; // Reserved AMR frame type.
    volume.writeFileSync("/in.3gp", bytes);
    const args = ["-y", "-v", "error", "-i", "/in.3gp", "-c:a", "pcm_s16le", "-f", "s16le", "/out.raw"];
    if (sync) {
      assert.equal(evalSyncFfmpeg(args, undefined,
        path => volume.readFileSync(path) as Buffer,
        (path, bytes) => { volume.writeFileSync(path, bytes); return true; }), malformed ? undefined : "");
    } else {
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args, cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, malformed ? 1 : 0, stderr);
    }
    if (malformed) {
      assert.equal(volume.readFileSync("/out.raw", "utf8"), "KEEP");
      return;
    }
    const pcm = volume.readFileSync("/out.raw") as Buffer;
    assert.equal(pcm.length, reference.length);
    for (let offset = 0; offset < pcm.length; offset += 2) {
      assert.ok(Math.abs(pcm.readInt16LE(offset) - reference.readInt16LE(offset)) <= 2, `sample ${offset / 2}`);
    }
  });
}
