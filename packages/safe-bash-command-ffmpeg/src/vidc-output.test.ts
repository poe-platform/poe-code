import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Native FFmpeg 7.0.2 uses pcm_mulaw for the VIDC muxer's default encoder.
const input = Buffer.from("0080ffff00000100ff7f", "hex");
const expected = Buffer.from("007effff80", "hex");

for (const format of ["vidc", "mulaw"]) {
  it(`writes raw ${format} from stdin to binary stdout`, async () => {
    const volume = Volume.fromJSON({});
    const stdout: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "pipe:0", "-f", format, "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () { yield input; })(),
      stdout: { async write(bytes: Uint8Array) { stdout.push(bytes.slice()); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(Buffer.concat(stdout), expected);
  });
}

for (const codec of [undefined, "pcm_mulaw", "copy"]) {
  it(`writes raw VIDC synchronously with ${codec ?? "default"} encoder`, () => {
    const volume = Volume.fromJSON({ "/in.raw": codec === "copy" ? expected : input });
    const result = evalSyncFfmpeg([
      "-y", "-v", "error", "-f", codec === "copy" ? "mulaw" : "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
      ...(codec ? ["-c:a", codec] : []), "-f", "vidc", "/out.raw"
    ], undefined, path => volume.readFileSync(path) as Buffer,
    (path, bytes) => { volume.writeFileSync(path, bytes); return true; });
    assert.equal(result, "");
    assert.deepEqual(volume.readFileSync("/out.raw"), expected);
  });
}
